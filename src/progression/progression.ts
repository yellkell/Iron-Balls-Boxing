/**
 * Bronze→Overlord progression: turn a cumulative XP total into a tier badge,
 * and price each mode's XP award. Pure functions over the PROGRESSION config —
 * no state, no I/O. The XP total itself lives in appState (persisted to
 * localStorage today, and to the player's Firestore profile once accounts land
 * in Phase 1).
 */

import { PROGRESSION } from '../config.js';

/**
 * Which ladder a duel counts toward FOR THIS PLAYER. Both boxers share one
 * matchmaking queue; each picks their own mode, so a quick player and a ranked
 * player can meet in the same bout and bank it differently.
 */
export type QueueMode = 'quick' | 'ranked';

export interface TierInfo {
  /** Tier name, e.g. 'GOLD'. */
  name: string;
  /** 0-based tier index (0 = Bronze). */
  index: number;
  /** Cumulative XP at which this tier begins. */
  floor: number;
  /** Cumulative XP at which the NEXT tier begins, or null at the top tier. */
  next: number | null;
  /** Progress through the current tier, 0..1 (always 1 at the top tier). */
  progress: number;
}

/** Resolve a cumulative XP total to its tier and progress toward the next. */
export function tierForXp(xp: number): TierInfo {
  const tiers = PROGRESSION.tiers;
  let index = 0;
  for (let i = 0; i < tiers.length; i++) {
    if (xp >= tiers[i].xp) index = i;
    else break;
  }
  const floor = tiers[index].xp;
  const next = index + 1 < tiers.length ? tiers[index + 1].xp : null;
  const progress = next === null ? 1 : (xp - floor) / (next - floor);
  return { name: tiers[index].name, index, floor, next, progress };
}

/** XP earned by an Aim Training run of `score`, capped; `newBest` adds a bonus. */
export function xpForTraining(score: number, newBest: boolean): number {
  const base = Math.min(
    PROGRESSION.trainingMax,
    Math.floor(Math.max(0, score) * PROGRESSION.trainingPerScore),
  );
  return base + (newBest ? PROGRESSION.trainingBestBonus : 0);
}

/**
 * XP earned by a completed duel against a real opponent, by the mode this
 * player queued as. Bot bouts earn nothing and never call this.
 */
export function xpForMatch(won: boolean, mode: QueueMode): number {
  const ranked = mode === 'ranked';
  const play = ranked ? PROGRESSION.rankedPlay : PROGRESSION.quickPlay;
  const win = won ? (ranked ? PROGRESSION.rankedWin : PROGRESSION.quickWin) : 0;
  return play + win;
}
