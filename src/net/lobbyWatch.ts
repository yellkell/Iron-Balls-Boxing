/**
 * Live list of open arcade LOBBIES for the lobby browser — 2v2, ffa or raid.
 *
 * A host creates an OPEN room doc in `arcadeRooms` (tagged with its `mode` and
 * the squad's callsigns); this watcher subscribes to the rooms of ONE mode and
 * reports the fresh, still-open, not-yet-started ones so the browser can list
 * them (each shows the host's name, the head-count and the raid hardcore flag).
 *
 * Same lifecycle discipline as rankedWatch: subscribe only while the browser is
 * on screen, tear it down on host/join/close, and load Firebase lazily so
 * players who never open a lobby never pay for the bundle.
 */

import type { ArcadeMode } from '../config.js';
import { FIREBASE_ENABLED } from './firebaseConfig.js';

/** A live lobby's members stamp `beat` on the room doc every 30 s (meshImpl).
 *  A beat older than this means every member crashed/quit without cleaning up
 *  — a zombie shell, not a joinable lobby. Legacy docs without a beat fall
 *  back to createdAt, so old abandoned rooms age out the same way. */
const BEAT_STALE_MS = 2 * 60 * 1000;

export interface LobbyRoom {
  /** The `arcadeRooms` doc id — passed to mesh.joinLobby to claim a seat. */
  id: string;
  /** The host's callsign, shown in the list. */
  host: string;
  /** Seats filled so far. */
  count: number;
  /** Seats this room's mode holds (its capacity). */
  cap: number;
  /** The lobby's hardcore breaker (raid only), so joiners know the stakes. */
  hardcore: boolean;
}

type ListListener = (rooms: LobbyRoom[]) => void;

let stop: (() => void) | null = null;
let starting = false;
/** The mode currently being watched, so a switch tears the old sub down. */
let watchedMode: ArcadeMode | null = null;

/** Begin watching the open lobbies of `mode`, reporting on every change. A
 *  call for a DIFFERENT mode than the live watch swaps it; a repeat call for
 *  the same mode is a no-op. */
export function startLobbyWatch(mode: ArcadeMode, onRooms: ListListener): void {
  if ((stop || starting) && watchedMode === mode) return;
  if (watchedMode !== mode) stopLobbyWatch(); // mode switch — drop the old sub
  if (!FIREBASE_ENABLED) {
    onRooms([]);
    return;
  }
  starting = true;
  watchedMode = mode;

  void (async () => {
    try {
      const { getApp, getApps, initializeApp } = await import('firebase/app');
      const { collection, getFirestore, onSnapshot, query, where } = await import('firebase/firestore');
      const { firebaseConfig } = await import('./firebaseConfig.js');
      const apps = getApps();
      const appFb = apps.length ? getApp() : initializeApp(firebaseConfig);
      const rooms = collection(getFirestore(appFb), 'arcadeRooms');

      const unsub = onSnapshot(
        query(rooms, where('mode', '==', mode), where('open', '==', true)),
        (snap) => {
          const now = Date.now();
          const list: LobbyRoom[] = [];
          snap.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.started === true) return;
            const created = (data.createdAt?.toMillis?.() as number | undefined) ?? now;
            const beat = (data.beat?.toMillis?.() as number | undefined) ?? created;
            if (now - beat > BEAT_STALE_MS) return; // nobody alive inside — zombie
            const seats = (data.seats as string[]) ?? [];
            const count = seats.filter(Boolean).length;
            if (count === 0) return; // an empty shell isn't a lobby
            const names = (data.names as string[]) ?? [];
            list.push({
              id: docSnap.id,
              host: typeof names[0] === 'string' && names[0] ? names[0] : 'BOXER',
              count,
              cap: (data.capacity as number | undefined) ?? seats.length ?? 4,
              hardcore: data.hardcore === true,
            });
          });
          list.sort((a, b) => a.id.localeCompare(b.id)); // stable rows
          onRooms(list);
        },
        () => onRooms([]), // listener errored (rules/offline) — empty list
      );

      if (starting && watchedMode === mode) {
        stop = unsub;
      } else {
        unsub(); // stopLobbyWatch (or a mode switch) landed while connecting
      }
    } catch {
      onRooms([]); // Firebase failed to load — nothing to list
    } finally {
      starting = false;
    }
  })();
}

/** Tear the listener down (leaving the browser). Safe when not watching. */
export function stopLobbyWatch(): void {
  starting = false;
  watchedMode = null;
  if (stop) {
    stop();
    stop = null;
  }
}
