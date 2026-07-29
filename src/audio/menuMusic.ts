/**
 * Lobby music — the "Smoldering" track that rides under the main menu.
 * It starts the moment you enter VR from the landing page (a user gesture, so
 * autoplay is allowed) and loops while you're in the LOBBY. It pauses the
 * instant you start a bout or aim training, and resumes when you land back in
 * the menu. A mute button on the lobby HUD toggles it, and the choice is
 * REMEMBERED in localStorage — mute it once and it stays silent on every future
 * visit until you un-mute.
 *
 * Plays through the Web Audio MusicTrack engine — NOT an HTMLAudioElement.
 * An audible <audio> element crashes Meta's Oculus Browser outright (see
 * musicPlayer.ts). Playback is the AND of three gates — entered VR, in the
 * lobby, not muted — funnelled through sync().
 */

import musicUrl from '../assets/music/smoldering.m4a?url';
import { MusicTrack } from './musicPlayer.js';
import { musicVolume, onMusicVolume } from './musicVolume.js';

const MUTE_KEY = 'ibb-music-muted';
const BASE_VOLUME = 0.5;
/** The lobby track's live level: its base scaled by the master music volume. */
function targetVol(): number {
  return BASE_VOLUME * musicVolume();
}

let track: MusicTrack | null = null;
let entered = false; // has the player entered VR (the autoplay-unlocking gesture)?
let lobbyActive = true; // are we in the menu/lobby (vs a bout or training)?
let fadeTimer: number | null = null;

function stopFade(): void {
  if (fadeTimer !== null) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
}

export function isMusicMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* private mode — the choice just won't persist */
  }
}

function ensureTrack(): MusicTrack {
  if (!track) {
    track = new MusicTrack(musicUrl, true);
    track.volume = targetVol();
  }
  return track;
}

/** Play only when we've entered VR, are in the lobby, and aren't muted —
 *  otherwise pause. Every state change funnels through here. */
function sync(): void {
  stopFade();
  if (entered && lobbyActive && !isMusicMuted()) {
    const t = ensureTrack();
    t.volume = targetVol();
    void t.start(); // resumes from wherever a bout paused it
  } else {
    track?.pause();
  }
}

/** Mark that we're in the lobby WITHOUT starting playback — the victory-sting
 *  handoff calls this the moment we land back in the menu, so that when its
 *  delayed fadeInMenuMusic fires it can tell whether we're STILL there. */
export function noteInLobby(): void {
  lobbyActive = true;
}

/** Bring the lobby music up with a gentle fade — used after the victory sting
 *  hands off. Stays silent if muted, not entered, or out of the lobby. The
 *  lobby check matters: this often fires seconds after the bout ended, and if
 *  the player has already launched ANOTHER bout by then, forcing the lobby
 *  track up would stack it under the new battle score. */
export function fadeInMenuMusic(): void {
  if (!lobbyActive || !(entered && !isMusicMuted())) {
    stopFade();
    track?.pause();
    return;
  }
  // Already up (e.g. just navigating menu ↔ queue) — leave it, don't re-fade.
  if (track?.playing && fadeTimer === null) return;
  stopFade();
  const t = ensureTrack();
  // Resume from wherever the level already is — a re-trigger mid-fade must
  // continue the climb, never yank the track back to silence and start over.
  const from = t.playing ? Math.min(t.volume, targetVol()) : 0;
  t.volume = from;
  void t.start();
  const steps = 30; // ~1.5 s at 50 ms
  let i = 0;
  fadeTimer = window.setInterval(() => {
    i += 1;
    const target = targetVol();
    t.volume = Math.min(target, from + ((target - from) * i) / steps);
    if (i >= steps) stopFade();
  }, 50);
}

// Live-scale the lobby track while it's playing steadily (a settings-panel
// slider scrub) — skip mid-fade, the fade recomputes toward the new target.
onMusicVolume(() => {
  if (track?.playing && fadeTimer === null) track.volume = targetVol();
});

/**
 * Start the lobby music — call once, inside the enter-VR click gesture, so the
 * browser allows playback. No-op if the player muted it on a previous visit or
 * isn't in the lobby.
 */
export function enterMenuMusic(): void {
  entered = true;
  sync();
}

/** Mark whether the player is in the lobby; pauses the music during a bout or
 *  aim training and resumes it on the way back to the menu. */
export function setMenuMusicActive(inLobby: boolean): void {
  lobbyActive = inLobby;
  sync();
}

/** Flip mute (persisted). Returns the new muted state for the HUD glyph. */
export function toggleMusicMuted(): boolean {
  const muted = !isMusicMuted();
  setMuted(muted);
  sync();
  return muted;
}
