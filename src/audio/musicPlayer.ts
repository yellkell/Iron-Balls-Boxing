/**
 * Web Audio music engine — the ONLY sanctioned way to play music and long
 * sampled tracks. Every module that used to hold a `new Audio(url)` element
 * (lobby / battle / tutorial / training music, the pub jukebox) now plays
 * through a `MusicTrack` from here instead.
 *
 * WHY THIS EXISTS — do not regress it: Meta's Oculus Browser build
 * (chromium-OculusBrowser stable-570200647, browser 149.x) has a broken
 * Android media-session bridge. The moment an AUDIBLE HTMLMediaElement
 * activates Chromium's media session — which any un-muted <audio> track
 * longer than a few seconds does when it starts playing — the browser's Java
 * side throws `NullPointerException … ComponentName.<init>` inside
 * `MediaSessionImpl.mediaSessionStateChanged` and the WHOLE browser process
 * dies. In the packaged store PWA that is: music starts, then "browser has
 * crashed". Reproduced 2/2 on Quest 3 via adb logcat, 2026-07-29. Web Audio
 * playback never activates a media session, so the broken path never runs.
 *
 * Rules of the road:
 *  - NEVER add an audible `new Audio(...)` / <video> player. If it makes
 *    sound and lives longer than an SFX blip, it goes through MusicTrack.
 *  - MUTED MediaStream pump elements (voice chat needs them — Chromium
 *    quirk) are fine: muted players never join the media session.
 *
 * Decoded-audio memory: PCM is ~15× the compressed file (≈ 23 MB per
 * stereo minute), so buffers are kept in a small LRU — the currently
 * playing ones are pinned, the rest are dropped beyond MAX_CACHED and
 * re-decoded on their next play (a few hundred ms, hidden behind fades).
 */

import { audioContext } from './sfx.js';

/** How a (re)start attempt landed — mirrors what element.play() rejections
 *  used to tell callers: playing, blocked-by-autoplay-policy, or broken. */
export type PlayResult = 'playing' | 'blocked' | 'error';

const MAX_CACHED = 3;

type CacheEntry = { promise: Promise<AudioBuffer>; lastUse: number };
const cache = new Map<string, CacheEntry>();
let useTick = 0;
/** URLs of tracks currently sounding — never evicted. */
const pinned = new Set<string>();

function bufferFor(url: string, ctx: AudioContext): Promise<AudioBuffer> {
  let entry = cache.get(url);
  if (!entry) {
    const promise = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} for ${url}`);
        return r.arrayBuffer();
      })
      .then((bytes) => ctx.decodeAudioData(bytes));
    // A failed fetch/decode must not poison the cache — retry next play.
    promise.catch(() => cache.delete(url));
    entry = { promise, lastUse: 0 };
    cache.set(url, entry);
  }
  entry.lastUse = ++useTick;
  evict();
  return entry.promise;
}

function evict(): void {
  while (cache.size > MAX_CACHED) {
    let oldest: string | null = null;
    let oldestUse = Infinity;
    for (const [url, e] of cache) {
      if (pinned.has(url)) continue;
      if (e.lastUse < oldestUse) {
        oldestUse = e.lastUse;
        oldest = url;
      }
    }
    if (!oldest) return; // everything left is pinned
    cache.delete(oldest);
  }
}

/**
 * One playable track: fetch + decode (cached), loop or one-shot, pause /
 * resume from where it left off, instant-but-clickless volume writes.
 * API is shaped like the HTMLAudioElement usage it replaces.
 */
export class MusicTrack {
  /** Fires on a NATURAL end only (never on pause()/stop()) — the battle
   *  rotation and the jukebox "insert coin for next track" hook. */
  onended: (() => void) | null = null;

  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private vol = 1;
  /** Where playback stands when paused; feeds the next start(). */
  private offset = 0;
  private startedAt = 0; // ctx.currentTime when the current source began (minus offset)
  private naturalEnd = false;
  /** Bumped by every state change; async work from a stale generation aborts. */
  private gen = 0;

  constructor(
    private readonly url: string,
    private readonly loop: boolean,
  ) {}

  /** Kick off fetch+decode ahead of the first play (best effort). */
  preload(): void {
    const ctx = audioContext();
    if (ctx) void bufferFor(this.url, ctx).catch(() => {});
  }

  get playing(): boolean {
    return this.source !== null;
  }

  /** True once a non-looping track has played out on its own. */
  get ended(): boolean {
    return this.naturalEnd;
  }

  get volume(): number {
    return this.vol;
  }

  /** Clickless level write — same call sites that used to set element.volume. */
  set volume(v: number) {
    this.vol = v;
    const ctx = audioContext();
    if (this.gain && ctx) this.gain.gain.setTargetAtTime(v, ctx.currentTime, 0.03);
  }

  /** Play from the top — element `currentTime = 0; play()` equivalent. */
  restart(): Promise<PlayResult> {
    this.halt();
    this.offset = 0;
    return this.start();
  }

  /**
   * Play, resuming from wherever pause() left the needle (0 if never played
   * or ended) — element `play()` equivalent. Safe to call while already
   * playing (no-op, stays 'playing').
   */
  async start(): Promise<PlayResult> {
    const myGen = ++this.gen;
    const ctx = audioContext();
    if (!ctx) return 'error';
    if (ctx.state !== 'running') {
      // resume() PENDS (not rejects) while the autoplay policy still wants a
      // gesture — never let that hang the whole start. Give it a beat, then
      // fall through: the 'running' gate below decides playing vs blocked.
      const resumed = ctx.resume().then(
        () => true,
        () => false,
      );
      await Promise.race([resumed, new Promise((r) => setTimeout(r, 250))]);
    }
    let buffer: AudioBuffer;
    try {
      buffer = await bufferFor(this.url, ctx);
    } catch {
      return 'error';
    }
    if (myGen !== this.gen) return 'playing'; // superseded by a newer call
    if (this.source) return 'playing'; // already sounding
    // The autoplay gate: if the context wouldn't run, starting a source now
    // would double-play on the caller's retry — report blocked instead.
    if (ctx.state !== 'running') return 'blocked';

    this.buffer = buffer;
    if (!this.gain) {
      this.gain = ctx.createGain();
      this.gain.gain.value = this.vol;
      this.gain.connect(ctx.destination);
    } else {
      this.gain.gain.setTargetAtTime(this.vol, ctx.currentTime, 0.03);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = this.loop;
    source.connect(this.gain);
    const from = this.loop ? this.offset % buffer.duration : Math.min(this.offset, buffer.duration);
    source.onended = () => {
      if (this.source !== source) return; // halted by us — pause()/stop()/restart()
      this.source = null;
      pinned.delete(this.url);
      this.offset = 0;
      this.naturalEnd = true;
      this.onended?.();
    };
    this.naturalEnd = false;
    this.startedAt = ctx.currentTime - from;
    this.source = source;
    pinned.add(this.url);
    source.start(0, from);
    return 'playing';
  }

  /** Stop sounding, remember the needle — element `pause()` equivalent. */
  pause(): void {
    const ctx = audioContext();
    if (this.source && ctx && this.buffer) {
      const at = ctx.currentTime - this.startedAt;
      this.offset = this.loop ? at % this.buffer.duration : Math.min(at, this.buffer.duration);
    }
    this.halt();
  }

  /** Stop and rewind to the top. */
  stop(): void {
    this.halt();
    this.offset = 0;
  }

  /** Tear down the current source without touching the remembered offset. */
  private halt(): void {
    this.gen++;
    const source = this.source;
    if (source) {
      this.source = null; // cleared FIRST so onended sees a foreign source
      pinned.delete(this.url);
      try {
        source.stop();
      } catch {
        /* never started or already stopped */
      }
      source.disconnect();
    }
  }
}
