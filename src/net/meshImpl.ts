/**
 * The heavy half of the arcade mesh (see net/mesh.ts for the facade): Firebase
 * Firestore matchmaking + WebRTC signalling. Loaded lazily by the facade so a
 * bot/training/1v1 player never pays for the Firebase bundle.
 *
 * Model: players join a per-mode ROOM and get a canonical SEAT (0..cap-1); seat
 * 0 hosts. Everyone connects peer-to-peer to everyone (a mesh): the lower seat
 * offers, the higher seat answers — the 1v1 codelab handshake, once per pair.
 * Incoming game messages are stamped with the sender's seat and pushed onto the
 * facade's inbox; the facade mirrors seat/occupant/full state for the systems.
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  addDoc,
  collection,
  deleteField,
  doc,
  FieldPath,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc,
  type DocumentReference,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig.js';
import { serverNow } from './serverClock.js';
import { voiceEnabled } from '../audio/voicePref.js';
import { ensureIceServers, iceConfig } from './iceConfig.js';
import type { ArcadeMode } from '../config.js';
import type { PeerMessage } from './protocol.js';
import type { MeshState } from './mesh.js';

const CAPACITY: Record<ArcadeMode, number> = { '1v1': 2, '2v2': 4, ffa: 4, raid: 5 };

/** A member tombstoned (page hidden) for longer than this, with no live data
 *  channel, has their seat freed for a replacement. Long enough that a Quest
 *  doze — headset off for a moment, system menu — lifts its tombstone well
 *  before eviction; short enough that a real death doesn't block the seat. */
const GONE_EVICT_MS = 90 * 1000;

let firebaseApp: FirebaseApp | undefined;
function db(): Firestore {
  firebaseApp ??= getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getFirestore(firebaseApp);
}

interface MeshWire {
  s: number;
  m: PeerMessage;
}

interface Peer {
  seat: number;
  pc: RTCPeerConnection;
  evt: RTCDataChannel | null;
  pose: RTCDataChannel | null;
  unsubs: Unsubscribe[];
  /** ICE candidates that arrived BEFORE the remote description was set —
   *  buffered and flushed after it lands (adding them early throws, and the
   *  snapshot listener never re-delivers an 'added', so they'd be lost and
   *  the pair could simply never connect). */
  pending: RTCIceCandidateInit[];
}

export class MeshImpl {
  private readonly clientId = Math.random().toString(36).slice(2, 10);
  private roomRef: DocumentReference | null = null;
  private peers = new Map<number, Peer>();
  /** Latest raw `seats` from the room doc (before masking dropped peers). */
  private rawSeats: string[] = [];
  /** seat → the id we've declared DEAD (headset died / went silent). Masked out
   *  of `occupants` so a hard-disconnected player stops counting as present,
   *  even though they never cleaned up their own seat in the room doc. */
  private droppedIds = new Map<number, string>();
  /** ids currently tombstoned on the room doc (page hidden — see onPageHide).
   *  A SOFT mask: refreshed from every snapshot, lifts when the sleeper wakes. */
  private goneIds = new Set<string>();
  private roomUnsub: Unsubscribe | null = null;
  private closed = false;
  private micStream: MediaStream | null = null;
  private micPromise: Promise<MediaStream | null> | null = null;
  /** Raid-lobby liveness heartbeat — the browser hides rooms whose beat went
   *  stale, so a lobby abandoned by a crash/quit stops being listed. */
  private beatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly state: MeshState) {}

  /** Always CREATE a fresh, visible lobby of `mode` (never auto-join) — the
   *  room browser is the front door; hosts and joiners take different paths. */
  async hostLobby(mode: ArcadeMode, name: string): Promise<void> {
    this.state.capacity = CAPACITY[mode];
    this.state.onStatus('opening a lobby…');
    const rooms = collection(db(), 'arcadeRooms');
    const seats = Array.from({ length: this.state.capacity }, (_, i) => (i === 0 ? this.clientId : ''));
    const names = Array.from({ length: this.state.capacity }, (_, i) => (i === 0 ? name : ''));
    this.roomRef = await addDoc(rooms, {
      mode,
      capacity: this.state.capacity,
      seats,
      names,
      hardcore: false,
      goopliath: false,
      difficulty: 'normal',
      started: false,
      open: true,
      createdAt: serverTimestamp(),
    });
    if (this.closed) return;
    this.state.mySeat = 0;
    this.state.joined = true;
    this.state.names[0] = name;
    this.state.onStatus('lobby open — waiting for players…');
    this.watchRoom();
    this.startBeat();
  }

  /**
   * Host a PRIVATE room of `mode` behind a shareable 5-digit code, and resolve
   * with the code.
   *
   * The document is the SAME shape as a listed lobby's, so every bit of the
   * seat/occupancy/signalling machinery below works on it unchanged — the only
   * differences are that it lives in its own `privateRooms` collection (which
   * is what keeps it out of the public browser, for free: the room browser only
   * ever watches `arcadeRooms`) and that its doc id IS the code.
   */
  async hostPrivate(mode: ArcadeMode, name: string): Promise<string> {
    this.state.capacity = CAPACITY[mode];
    this.state.onStatus('reserving a code…');
    const coll = collection(db(), 'privateRooms');
    const seats = Array.from({ length: this.state.capacity }, (_, i) => (i === 0 ? this.clientId : ''));
    const names = Array.from({ length: this.state.capacity }, (_, i) => (i === 0 ? name : ''));
    for (let attempt = 0; attempt < 8 && !this.closed; attempt++) {
      const code = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
      const ref = doc(coll, code);
      try {
        await runTransaction(db(), async (txn) => {
          // Any existing doc means that code is in use — close() deletes a room
          // once its last member leaves, so live codes are the only ones held.
          if ((await txn.get(ref)).exists()) throw new Error('taken');
          txn.set(ref, {
            mode,
            capacity: this.state.capacity,
            seats,
            names,
            hardcore: false,
            goopliath: false,
            difficulty: 'normal',
            started: false,
            open: true,
            createdAt: serverTimestamp(),
          });
        });
        this.roomRef = ref;
        this.state.mySeat = 0;
        this.state.joined = true;
        this.state.names[0] = name;
        this.state.onStatus('share the code — waiting for players…');
        this.watchRoom();
        this.startBeat();
        return code;
      } catch {
        /* code collided — try another */
      }
    }
    throw new Error('could not allocate a code');
  }

  /**
   * Claim a seat in a private room by CODE. Resolves with the room's own mode,
   * so a joiner never has to be told which format the code is for — they type
   * five digits and land in the host's lobby. Null = unknown code, full, or
   * already launched.
   */
  async joinPrivate(code: string, name: string): Promise<ArcadeMode | null> {
    this.state.onStatus('looking up the code…');
    const ref = doc(collection(db(), 'privateRooms'), code);
    try {
      const claim = await runTransaction(db(), async (txn) => {
        const fresh = await txn.get(ref);
        if (!fresh.exists()) throw new Error('no such code');
        const data = fresh.data();
        if (data.open !== true || data.started === true) throw new Error('closed');
        const seats = (data.seats as string[]) ?? [];
        const names = (data.names as string[]) ?? seats.map(() => '');
        const free = seats.findIndex((s) => !s);
        if (free < 0) throw new Error('full');
        seats[free] = this.clientId;
        names[free] = name;
        txn.update(ref, { seats, names, open: !seats.every((s) => s) });
        return { seat: free, mode: data.mode as ArcadeMode, capacity: seats.length };
      });
      if (this.closed) return null;
      this.roomRef = ref;
      this.state.capacity = claim.capacity;
      this.state.mySeat = claim.seat;
      this.state.joined = true;
      this.state.names[claim.seat] = name;
      this.state.onStatus(`joined (seat ${claim.seat})`);
      this.watchRoom();
      this.startBeat();
      return claim.mode;
    } catch {
      return null; // the caller decides what to try next / what to say
    }
  }

  /** Claim a seat in a SPECIFIC listed lobby of `mode`. False = filled/gone. */
  async joinLobby(mode: ArcadeMode, roomId: string, name: string): Promise<boolean> {
    this.state.capacity = CAPACITY[mode];
    this.state.onStatus('joining the lobby…');
    const ref = doc(collection(db(), 'arcadeRooms'), roomId);
    try {
      const seat = await runTransaction(db(), async (txn) => {
        const fresh = await txn.get(ref);
        if (!fresh.exists() || fresh.data()?.open !== true || fresh.data()?.started === true) {
          throw new Error('gone');
        }
        const seats = (fresh.data().seats as string[]) ?? [];
        const names = (fresh.data().names as string[]) ?? seats.map(() => '');
        const free = seats.findIndex((s) => !s);
        if (free < 0) throw new Error('full');
        seats[free] = this.clientId;
        names[free] = name;
        txn.update(ref, { seats, names, open: !seats.every((s) => s) });
        return free;
      });
      if (this.closed) return false;
      this.roomRef = ref;
      this.state.mySeat = seat;
      this.state.joined = true;
      this.state.names[seat] = name;
      this.state.onStatus(`joined (seat ${seat})`);
      this.watchRoom();
      this.startBeat(); // any live member keeps the lobby listed, not just the host
      return true;
    } catch (err) {
      // Surface WHY: 'full'/'gone' are normal races, anything else is the
      // network/rules failing us — swallowing those cost a night of guessing.
      // eslint-disable-next-line no-console
      console.warn('[mesh] joinLobby failed:', err);
      this.state.onStatus(err instanceof Error && err.message === 'full' ? 'that lobby just filled' : 'that lobby just closed');
      return false;
    }
  }

  /** Stamp `beat` on the room every 30 s while I'm a live member. The raid
   *  browser hides rooms whose beat is stale, so lobbies orphaned by a crash,
   *  a closed tab or a sleeping headset fall off the list on their own —
   *  nothing client-side can be relied on to clean up after a hard death. */
  private startBeat(): void {
    if (this.beatTimer !== null) return;
    const tick = (): void => {
      if (this.closed || !this.roomRef) return;
      void updateDoc(this.roomRef, { beat: serverTimestamp() }).catch(() => {});
    };
    tick();
    this.beatTimer = setInterval(tick, 30_000);
  }

  /** RAID host: flip the lobby's hardcore breaker (room doc mirrors it out). */
  setRaidHardcore(v: boolean): void {
    if (this.roomRef) void updateDoc(this.roomRef, { hardcore: v }).catch(() => {});
  }

  /** RAID host: throw the FIGHT GOOPLIATH breaker (room doc mirrors it out). */
  setRaidGoopliath(v: boolean): void {
    if (this.roomRef) void updateDoc(this.roomRef, { goopliath: v }).catch(() => {});
  }

  /** RAID host: set the run difficulty (room doc mirrors it out). */
  setRaidDifficulty(v: string): void {
    if (this.roomRef) void updateDoc(this.roomRef, { difficulty: v }).catch(() => {});
  }

  /** Host: lock the lobby and launch — members see `started` flip. */
  startLobby(): void {
    if (this.roomRef) void updateDoc(this.roomRef, { started: true, open: false }).catch(() => {});
  }

  send(msg: PeerMessage): void {
    if (!this.state.joined) return;
    const wire: MeshWire = { s: this.state.mySeat, m: msg };
    const data = JSON.stringify(wire);
    for (const peer of this.peers.values()) {
      const ch = msg.k === 'pose' && peer.pose?.readyState === 'open' ? peer.pose : peer.evt;
      if (ch?.readyState === 'open') {
        try {
          ch.send(data);
        } catch {
          /* channel mid-close */
        }
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('pageshow', this.onPageShow);
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.beatTimer !== null) {
      clearInterval(this.beatTimer);
      this.beatTimer = null;
    }
    this.roomUnsub?.();
    this.roomUnsub = null;
    for (const peer of this.peers.values()) {
      for (const u of peer.unsubs) u();
      peer.evt?.close();
      peer.pose?.close();
      peer.pc.close();
    }
    this.peers.clear();
    this.rawSeats = [];
    this.droppedIds.clear();
    for (const track of this.micStream?.getTracks() ?? []) track.stop();
    this.micStream = null;
    this.state.voice.clear();
    if (this.roomRef) {
      const ref = this.roomRef;
      const seat = this.state.mySeat;
      const id = this.clientId;
      void runTransaction(db(), async (txn) => {
        const snap = await txn.get(ref);
        if (!snap.exists()) return;
        const seats = (snap.data().seats as string[]) ?? [];
        // Last one out deletes the room, WHATEVER seat they hold — a raid's
        // host (seat 0) usually leaves first at run end, and the old seat-0-
        // only rule left every finished raid behind as a zombie doc.
        if (seats.filter((s) => s).length <= 1 && (!seats[seat] || seats[seat] === id)) {
          txn.delete(ref);
        } else if (seats[seat] === id) {
          seats[seat] = '';
          txn.update(ref, { seats, open: true });
        }
      }).catch(() => {});
    }
    this.roomRef = null;
  }

  /**
   * Best-effort ghost prevention when the PAGE goes away under us — closed
   * tab, killed browser, OR a Quest headset merely DOZING (proximity sensor,
   * system menu: pagehide fires for all of them, and doze is by far the most
   * common). close() never runs in any of these, and an SDK write wouldn't
   * survive teardown; a keepalive REST commit does.
   *
   * We stamp a TIMESTAMPED `gone.<myId>` tombstone — never a delete. An
   * earlier version deleted the doc when we were the last occupant, which
   * "cleaned up" every solo host's LIVE room the moment they glanced away
   * from the headset (pagehide-on-doze), vaporising the lobby under them.
   * A tombstone is reversible: onPageShow lifts it when the nap ends, while
   * a REAL death leaves it in place — browsers/counters skip tombstoned
   * seats immediately, and a room with nobody un-tombstoned reads empty,
   * drops off every list, and ages into the reaper. One map key is ours
   * alone, so this can't race the survivors' seat writes either.
   */
  private readonly onPageHide = (): void => {
    if (this.closed || !this.roomRef) return;
    if (this.rawSeats[this.state.mySeat] !== this.clientId) return; // not seated
    const db = `projects/${firebaseConfig.projectId}/databases/(default)`;
    const name = `${db}/documents/${this.roomRef.path}`;
    const body = {
      writes: [
        {
          transform: {
            document: name,
            fieldTransforms: [
              // Backtick-quoted segment: a random id can start with a digit.
              { fieldPath: 'gone.`' + this.clientId + '`', setToServerValue: 'REQUEST_TIME' },
            ],
          },
        },
      ],
    };
    try {
      void fetch(`https://firestore.googleapis.com/v1/${db}/documents:commit?key=${firebaseConfig.apiKey}`, {
        method: 'POST',
        keepalive: true, // survives page teardown, unlike the SDK's write
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => {});
    } catch {
      /* the page is going down — nothing else to try */
    }
  };

  /** The nap ended (pageshow / tab visible again): lift my tombstone and
   *  freshen the beat, so a dozing host's room comes straight back to life. */
  private readonly onPageShow = (): void => {
    if (this.closed || !this.roomRef || !this.state.joined) return;
    void updateDoc(this.roomRef, new FieldPath('gone', this.clientId), deleteField(), 'beat', serverTimestamp()).catch(
      () => {
        /* room reaped while we slept — the next snapshot / join tells the tale */
      },
    );
  };

  /** Quest fires visibilitychange more reliably than pageshow on wake. */
  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'visible') this.onPageShow();
  };

  private watchRoom(): void {
    if (!this.roomRef) return;
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.roomUnsub = onSnapshot(this.roomRef, (snap) => {
      if (!snap.exists() || this.closed) return;
      this.rawSeats = (snap.data().seats as string[]) ?? [];
      // Tombstones are a SOFT mask (a dozing headset lifts its own on wake —
      // see onPageHide/onPageShow), so they're applied at read time in
      // applyOccupants rather than through the permanent droppedIds path.
      const goneMap = (snap.data().gone as Record<string, unknown> | undefined) ?? {};
      this.goneIds = new Set(Object.keys(goneMap));
      this.applyOccupants();
      // A member tombstoned long past any nap, with no live channel to us,
      // is dead — free their seat for a replacement (idempotent, any member
      // may do it; the id guard in vacateSeatInDoc de-dupes).
      const nowMs = serverNow();
      for (let seat = 0; seat < this.rawSeats.length; seat++) {
        const id = this.rawSeats[seat];
        if (!id || seat === this.state.mySeat || !this.goneIds.has(id)) continue;
        const stamped = (goneMap[id] as { toMillis?: () => number } | undefined)?.toMillis?.();
        const evt = this.peers.get(seat)?.evt;
        if (typeof stamped === 'number' && nowMs - stamped > GONE_EVICT_MS && evt?.readyState !== 'open') {
          this.vacateSeatInDoc(seat, id);
        }
      }
      this.state.locked = snap.data().open === false;
      // RAID lobby extras: seed the callsigns from the doc (the `iam` message
      // re-affirms them in the bout) and mirror the host's controls.
      const docNames = snap.data().names as string[] | undefined;
      if (docNames) {
        docNames.forEach((n, i) => {
          if (n && !this.state.names[i]) this.state.names[i] = n;
        });
      }
      this.state.raidHardcore = snap.data().hardcore === true;
      this.state.raidGoopliath = snap.data().goopliath === true;
      const d = snap.data().difficulty;
      this.state.raidDifficulty = d === 'easy' || d === 'hard' || d === 'blazing' ? d : 'normal';
      this.state.started = snap.data().started === true;
      if (this.state.full) this.state.onStatus('all players in — fight!');
      const occ = this.state.occupants; // masked — never (re)connect a dropped seat
      for (let seat = 0; seat < occ.length; seat++) {
        if (seat === this.state.mySeat || !occ[seat] || this.peers.has(seat)) continue;
        if (this.state.mySeat < seat) void this.connectAsOfferer(seat);
        else void this.connectAsAnswerer(seat);
      }
    });
  }

  /** Publish `occupants` from the raw seats with any dropped ids masked to ''.
   *  Tombstoned ids (page hidden — maybe napping, maybe dead) are masked the
   *  same way but SOFTLY: the mask lifts by itself if their tombstone clears.
   *  Never mask MYSELF on my own tombstone — my wake-up write is in flight,
   *  and blanking my own name out of my own lobby reads as "I vanished". */
  private applyOccupants(): void {
    // Forget a drop once the doc no longer holds that dead id there (seat freed
    // or reclaimed by a fresh player), so a replacement isn't wrongly masked.
    for (const [seat, id] of this.droppedIds) if (this.rawSeats[seat] !== id) this.droppedIds.delete(seat);
    this.state.occupants = this.rawSeats.map((s, i) =>
      s && (this.droppedIds.get(i) === s || (this.goneIds.has(s) && s !== this.clientId)) ? '' : s,
    );
    this.state.full = this.state.occupants.length > 0 && this.state.occupants.every((s) => s);
  }

  /** Declare a seat dead (its peer died / went silent). Reachable from the pose
   *  staleness backstop in MeshSystem, as well as from dropPeer on RTC failure. */
  dropSeat(seat: number): void {
    this.dropPeer(seat);
  }

  private markDropped(seat: number): void {
    const id = this.rawSeats[seat];
    if (!id || this.droppedIds.get(seat) === id) return;
    this.droppedIds.set(seat, id);
    this.applyOccupants();
    this.vacateSeatInDoc(seat, id);
  }

  /** Free a dead player's seat in the room doc so a replacement can claim it —
   *  a hard-disconnected client never cleans up its own seat. Best-effort +
   *  idempotent (every survivor may attempt it; the id guard makes all but the
   *  first bail). ONLY while the room is still FILLING: emptying a seat in a
   *  live (locked/started) bout wouldn't let anyone replace them anyway — all
   *  it did was broadcast ONE client's (possibly mistaken) drop verdict to the
   *  whole squad, eliminating that player for everyone. In a live bout each
   *  client keeps its own local mask instead. */
  private vacateSeatInDoc(seat: number, deadId: string): void {
    const ref = this.roomRef;
    if (!ref) return;
    void runTransaction(db(), async (txn) => {
      const snap = await txn.get(ref);
      if (!snap.exists()) return;
      if (snap.data().open === false) return; // live bout — seats stay put
      const seats = (snap.data().seats as string[]) ?? [];
      if (seats[seat] !== deadId) return; // already vacated / reclaimed
      seats[seat] = '';
      txn.update(ref, { seats, open: !seats.every((s) => s) });
    }).catch(() => {});
  }

  // --- mesh signalling (one pair = one `sig` doc) --------------------------

  private sigRef(lo: number, hi: number): DocumentReference {
    return doc(collection(this.roomRef!, 'sig'), `${lo}_${hi}`);
  }

  private newPeer(seat: number): Peer {
    const pc = new RTCPeerConnection(iceConfig());
    const peer: Peer = { seat, pc, evt: null, pose: null, unsubs: [], pending: [] };
    this.peers.set(seat, peer);
    pc.onconnectionstatechange = () => {
      // Only terminal states drop the peer outright. 'disconnected' is
      // TRANSIENT — ICE routinely blips through it and recovers (Quest Wi-Fi
      // especially), and a drop here is PERMANENT (dropped seats are masked
      // and never reconnected) — it was silently killing raiders who were
      // still very much present. A genuinely dead peer still gets caught:
      // 'failed'/'closed' land here, and in a live bout the pose-staleness
      // backstop (MeshSystem) is faster.
      // NO 'disconnected' drop, even in the lobby: a dozing Quest (headset
      // off for a moment) blips through 'disconnected' constantly, and a
      // 5 s in-lobby grace here was evicting nappers. Clean leaves are
      // caught fast by the data channel's onclose (adopt); real deaths by
      // 'failed'/'closed' here, the gone-tombstone eviction (watchRoom),
      // and in live bouts the pose-staleness backstop.
      if (['failed', 'closed'].includes(pc.connectionState)) this.dropPeer(seat);
    };
    // Spatial voice: surface this peer's mic track to the facade, keyed by seat.
    pc.ontrack = (ev) => {
      if (ev.track.kind !== 'audio') return;
      this.state.voice.set(seat, ev.streams[0] ?? new MediaStream([ev.track]));
    };
    return peer;
  }

  /** Grab the mic once (shared across every peer). Null if denied/unavailable. */
  private ensureMic(): Promise<MediaStream | null> {
    this.micPromise ??= navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then((s) => {
        this.micStream = s;
        // Honour the voice-chat preference: a disabled mic transmits nothing.
        for (const t of s.getAudioTracks()) t.enabled = voiceEnabled();
        return s;
      })
      .catch(() => null);
    return this.micPromise;
  }

  /** Add my mic to a peer connection (recvonly if the mic was denied). */
  private async addVoice(pc: RTCPeerConnection): Promise<void> {
    const mic = await this.ensureMic();
    if (this.closed) return;
    if (mic) for (const track of mic.getTracks()) pc.addTrack(track, mic);
    else
      try {
        pc.addTransceiver('audio', { direction: 'recvonly' });
      } catch {
        /* no audio support — data channels still work */
      }
  }

  private adopt(peer: Peer, evt: RTCDataChannel, pose: RTCDataChannel | null): void {
    peer.evt = evt;
    peer.pose = pose;
    const onMsg = (ev: MessageEvent): void => {
      try {
        const wire = JSON.parse(String(ev.data)) as MeshWire;
        if (this.state.inbox.length < 512) this.state.inbox.push({ seat: wire.s, msg: wire.m });
      } catch {
        /* drop malformed */
      }
    };
    evt.onmessage = onMsg;
    if (pose) pose.onmessage = onMsg;
    // A peer that LEAVES cleanly (menu quit, tab closed) tears its connection
    // down, and their evt channel closes on our side within a beat — but this
    // was ignored, so the leaver stood in the room until ICE ground through to
    // 'failed' (~30 s of "it hasn't noticed they left"). The 1v1 path has
    // always dropped on channel close; the mesh now does too. Our own close()
    // detaches first, so this never fires for our own teardown.
    evt.onclose = () => {
      if (!this.closed && this.peers.get(peer.seat) === peer) this.dropPeer(peer.seat);
    };
  }

  private async connectAsOfferer(seat: number): Promise<void> {
    await ensureIceServers(); // TURN creds ready before the PC is built
    if (this.closed || this.peers.has(seat)) return;
    const peer = this.newPeer(seat);
    const pc = peer.pc;
    this.adopt(
      peer,
      pc.createDataChannel('evt', { ordered: true }),
      pc.createDataChannel('pose', { ordered: false, maxRetransmits: 0 }),
    );
    const ref = this.sigRef(this.state.mySeat, seat);
    const myCands = collection(ref, `c${this.state.mySeat}`);
    const theirCands = collection(ref, `c${seat}`);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) void addDoc(myCands, ev.candidate.toJSON()).catch(() => {});
    };
    await this.addVoice(pc); // mic m-line must be in the offer SDP
    if (this.closed) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await runTransaction(db(), async (txn) => {
      txn.set(ref, { offer: { type: offer.type, sdp: offer.sdp } }, { merge: true });
    });
    peer.unsubs.push(
      onSnapshot(ref, (snap) => {
        const answer = snap.data()?.answer as RTCSessionDescriptionInit | undefined;
        if (answer && !pc.currentRemoteDescription) {
          void pc
            .setRemoteDescription(new RTCSessionDescription(answer))
            .then(() => this.flushCandidates(peer))
            .catch(() => {});
        }
      }),
    );
    this.drink(peer, theirCands);
  }

  private async connectAsAnswerer(seat: number): Promise<void> {
    await ensureIceServers(); // TURN creds ready before the PC is built
    if (this.closed || this.peers.has(seat)) return;
    const peer = this.newPeer(seat);
    const pc = peer.pc;
    pc.ondatachannel = (ev) => {
      const chans = [peer.evt, peer.pose, ev.channel].filter(Boolean) as RTCDataChannel[];
      const evt = chans.find((c) => c.label === 'evt') ?? null;
      const pose = chans.find((c) => c.label === 'pose') ?? null;
      if (evt) this.adopt(peer, evt, pose);
    };
    const ref = this.sigRef(seat, this.state.mySeat);
    const myCands = collection(ref, `c${this.state.mySeat}`);
    const theirCands = collection(ref, `c${seat}`);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) void addDoc(myCands, ev.candidate.toJSON()).catch(() => {});
    };
    peer.unsubs.push(
      onSnapshot(ref, (snap) => {
        const offer = snap.data()?.offer as RTCSessionDescriptionInit | undefined;
        if (offer && !pc.currentRemoteDescription) {
          void (async () => {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            // Flush buffered candidates NOW — addVoice below can stall for
            // seconds on the mic-permission prompt, and the offerer's trickle
            // candidates mostly arrive inside exactly that window.
            this.flushCandidates(peer);
            await this.addVoice(pc); // answer with my mic too
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await updateDoc(ref, { answer: { type: answer.type, sdp: answer.sdp } });
          })().catch(() => {});
        }
      }),
    );
    this.drink(peer, theirCands);
  }

  private drink(peer: Peer, cands: ReturnType<typeof collection>): void {
    peer.unsubs.push(
      onSnapshot(cands, (snap) => {
        for (const change of snap.docChanges()) {
          if (change.type !== 'added') continue;
          const cand = change.doc.data() as RTCIceCandidateInit;
          // Trickle-ICE race: a candidate landing before the remote
          // description throws inside addIceCandidate and is gone for good
          // (snapshots never re-deliver an 'added') — pairs that lost this
          // race never connected AT ALL. Buffer early arrivals; the
          // handshake flushes them right after setRemoteDescription.
          if (!peer.pc.remoteDescription) peer.pending.push(cand);
          else void peer.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }
      }),
    );
  }

  /** Feed the buffered early candidates in, now that the remote SDP is set. */
  private flushCandidates(peer: Peer): void {
    for (const cand of peer.pending.splice(0)) {
      void peer.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
    }
  }

  private dropPeer(seat: number): void {
    const peer = this.peers.get(seat);
    if (peer) {
      for (const u of peer.unsubs) u();
      // Delete from the map BEFORE closing, so the channels' own onclose
      // (fired async by our close() calls) sees a stale peer and bails.
      this.peers.delete(seat);
      peer.evt?.close();
      peer.pose?.close();
      peer.pc.close();
    }
    this.state.voice.delete(seat);
    // Mask the seat so the roster/match layer sees the player as gone — even
    // though a hard-disconnected client never vacates its own seat in the doc.
    this.markDropped(seat);
  }
}
