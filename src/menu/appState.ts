/**
 * Top-level app state — the lobby vs. an active bout vs. Aim Training.
 *
 *  - 'menu'     : standing on your platform at the floating menu, choosing.
 *  - 'queueing' : you pressed 1V1 QUICK MATCH; waiting for the relay server
 *                 to pair you with another boxer.
 *  - 'playing'  : a bout is live, vs the bot (`mode: 'bot'`) or a real
 *                 opponent over the wire (`mode: 'net'`).
 *  - 'training' : Aim Training — pop-up targets, optional return fire.
 *
 * MenuSystem and NetworkSystem own the transitions; the combat systems read
 * `state`/`mode` to know when and what to simulate.
 */

import { ELO_START, PLACEMENTS, eloDelta, type QueueMode } from '../progression/progression.js';

export type AppState = 'menu' | 'queueing' | 'playing' | 'training';
export type AppMode = 'bot' | 'net';

export interface LifetimeStats {
  wins: number;
  losses: number;
  trainingBest: number;
  ballsThrown: number;
  hitsLanded: number;
  /** Cumulative progression XP across every mode — drives the tier badge. */
  xp: number;
  /** Ranked skill rating — drives the Ranked leaderboard. Moves up and down. */
  elo: number;
  /** Ranked games left before the rating leaves provisional / shows on the board. */
  placementsLeft: number;
  rankedWins: number;
  rankedLosses: number;
}

const STATS_DEFAULTS: LifetimeStats = {
  wins: 0,
  losses: 0,
  trainingBest: 0,
  ballsThrown: 0,
  hitsLanded: 0,
  xp: 0,
  elo: ELO_START,
  placementsLeft: PLACEMENTS,
  rankedWins: 0,
  rankedLosses: 0,
};

function loadStats(): LifetimeStats {
  try {
    const raw = localStorage.getItem('ff-stats');
    if (raw) return { ...STATS_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* fresh start */
  }
  return { ...STATS_DEFAULTS };
}

export const app: {
  state: AppState;
  mode: AppMode;
  /** Network side: 0 = host (match authority), 1 = guest. */
  side: 0 | 1;
  /**
   * Which ladder a real duel banks toward for THIS player. Quick and ranked
   * share one queue; each boxer's own selection decides how the bout counts.
   * Phase 3's RANKED button flips this; default is a casual quick match.
   */
  queueMode: QueueMode;
  /** Human-readable connection status for the lobby info panel. */
  netStatus: string;
  /** Aim Training option: targets shoot back so you can train dodging. */
  shootBack: boolean;
  stats: LifetimeStats;
  /** XP banked by the most recent earning event, for a lobby "+N XP" readout. */
  lastXpGain: number;
  /** Signed ELO change from the most recent ranked bout, for a "±N ELO" readout. */
  lastEloDelta: number;
  /**
   * Tier index the player has been SHOWN. PromotionSystem sets it on the first
   * lobby frame (so a cloud-merge bump isn't mistaken for a promotion), then
   * plays the promotion FX whenever the live tier climbs above it. -1 = unseen.
   */
  shownTier: number;
  /**
   * Cloud identity. `uid` is the Anonymous Auth user; `synced` is true once the
   * Firestore `players/{uid}` doc is loaded and writes are flowing. Until then
   * the game runs entirely on the localStorage cache.
   */
  profile: { uid: string | null; synced: boolean; displayName: string };
} = {
  state: 'menu',
  mode: 'bot',
  side: 0,
  queueMode: 'quick',
  netStatus: 'not connected',
  shootBack: localStorage.getItem('ff-shootback') !== '0',
  stats: loadStats(),
  lastXpGain: 0,
  lastEloDelta: 0,
  shownTier: -1,
  profile: { uid: null, synced: false, displayName: '' },
};

/** Bank progression XP. Caller persists via saveStats(); returns the amount. */
export function addXp(amount: number): number {
  if (amount <= 0) return 0;
  app.stats.xp += amount;
  app.lastXpGain = amount;
  return amount;
}

/**
 * Settle a ranked result against the opponent's rating. Updates ELO, burns a
 * placement, tallies the ranked W/L, and records the delta for the UI. Caller
 * persists via saveStats(); returns the signed rating change.
 */
export function applyRanked(won: boolean, oppElo: number): number {
  const delta = eloDelta(app.stats.elo, oppElo, won, app.stats.placementsLeft);
  app.stats.elo = Math.max(0, app.stats.elo + delta);
  if (app.stats.placementsLeft > 0) app.stats.placementsLeft -= 1;
  if (won) app.stats.rankedWins += 1;
  else app.stats.rankedLosses += 1;
  app.lastEloDelta = delta;
  return delta;
}

/**
 * Optional sink notified after every saveStats() — the profile layer sets this
 * to push changes up to Firestore. Kept as a hook so appState carries no
 * Firebase dependency (the SDK stays lazily loaded).
 */
let statsListener: (() => void) | null = null;
export function setStatsListener(fn: (() => void) | null): void {
  statsListener = fn;
}

export function saveStats(): void {
  try {
    localStorage.setItem('ff-stats', JSON.stringify(app.stats));
  } catch {
    /* storage unavailable — stats stay in-memory */
  }
  statsListener?.();
}

export function saveShootBack(): void {
  try {
    localStorage.setItem('ff-shootback', app.shootBack ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Live Aim Training session numbers (TrainingSystem writes, UI reads). */
export const training = {
  active: false,
  score: 0,
  hits: 0,
  thrown: 0,
  streak: 0,
  bestStreak: 0,
  timeLeft: 0,
  /** Set when a run ends so the UI can show the result. */
  lastScore: 0,
};
