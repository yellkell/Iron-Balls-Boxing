/**
 * Tutorial music — the battle cut of "Breakcore" (the longer version from the
 * battle rotation) looping for the whole guided basics tutorial. The tutorial
 * rides a bot bout, during which the lobby music is paused (you've left the
 * menu) and the battle score is suppressed (`if (!app.tutorial)
 * startBattleMusic()`), so nothing else is playing — this fills that gap.
 * TutorialSystem starts it when the tutorial begins and stops it when the
 * tutorial ends (graduation KO, forfeit, or bail).
 *
 * Plays through the Web Audio MusicTrack engine (an audible HTMLAudioElement
 * crashes Meta's Oculus Browser — see musicPlayer.ts); honours the same
 * persisted mute as the lobby music.
 */

import { isMusicMuted } from './menuMusic.js';
import { MusicTrack } from './musicPlayer.js';
import { musicVolume } from './musicVolume.js';
import breakcoreUrl from '../assets/music/battle/breakcore-drums.m4a?url';

const VOLUME = 0.12; // matched to the battle-music floor — music is the floor, SFX the foreground

let track: MusicTrack | null = null;

/** Loop the tutorial track from the top. No-op if muted. */
export function startTutorialMusic(): void {
  if (isMusicMuted()) return;
  if (!track) track = new MusicTrack(breakcoreUrl, true);
  track.volume = VOLUME * musicVolume();
  void track.restart();
}

/** Stop the tutorial track (the lobby music comes back up on the way out). */
export function stopTutorialMusic(): void {
  track?.pause();
}
