/**
 * Top-level app state — the lobby vs. an active bout vs. Aim Training.
 *
 *  - 'menu'     : standing on your platform at the floating menu, choosing.
 *  - 'queueing' : you pressed 1V1 QUICK MATCH; waiting for the relay server
 *                 to pair you with another boxer.
 *  - 'playing'  : a bout is live — vs the bot (`mode: 'bot'`), a real
 *                 opponent over the wire (`mode: 'net'`), or an arcade titan
 *                 (`mode: 'campaign'`, stage in `campaignStage`).
 *  - 'training' : Aim Training — pop-up targets, optional return fire.
 *
 * MenuSystem and NetworkSystem own the transitions; the combat systems read
 * `state`/`mode` to know when and what to simulate.
 */

import { CAMPAIGN } from '../config.js';

export type AppState = 'menu' | 'queueing' | 'playing' | 'training';
export type AppMode = 'bot' | 'net' | 'campaign';

export interface LifetimeStats {
  wins: number;
  losses: number;
  trainingBest: number;
  ballsThrown: number;
  hitsLanded: number;
  /** Currency — the arena pays out in salvaged plate. */
  scrap: number;
  /** Lifetime experience; level is derived (see combat/rewards.ts). */
  xp: number;
  /** One flag per arcade stage: true once that titan has been felled. */
  campaignCleared: boolean[];
  /** Unlocked by felling the final titan: the gold CHAMPION platform. */
  championPlatform: boolean;
  /** Loadout: which platform skin stands under you. */
  platformSkin: 'standard' | 'champion';
  /** Best GAUNTLET RUN times (seconds of fight time), ascending, capped. */
  runTimesGauntlet: number[];
  /** Best HARDCORE run times — no healing between titans. */
  runTimesHardcore: number[];
  /** Set by finishing your first gauntlet run: hardcore opens. */
  hardcoreUnlocked: boolean;
}

function freshStats(): LifetimeStats {
  return {
    wins: 0,
    losses: 0,
    trainingBest: 0,
    ballsThrown: 0,
    hitsLanded: 0,
    scrap: 0,
    xp: 0,
    campaignCleared: new Array(CAMPAIGN.stages).fill(false),
    championPlatform: false,
    platformSkin: 'standard',
    runTimesGauntlet: [],
    runTimesHardcore: [],
    hardcoreUnlocked: false,
  };
}

function loadStats(): LifetimeStats {
  try {
    const raw = localStorage.getItem('ff-stats');
    if (raw) {
      const stats = { ...freshStats(), ...JSON.parse(raw) } as LifetimeStats;
      // Older saves (or a future stage-count bump) may carry a short array.
      while (stats.campaignCleared.length < CAMPAIGN.stages) stats.campaignCleared.push(false);
      return stats;
    }
  } catch {
    /* fresh start */
  }
  return freshStats();
}

export const app: {
  state: AppState;
  mode: AppMode;
  /**
   * Which lobby page is showing while state is 'menu'/'queueing': the main
   * panel arc, or the ARCADE campaign sub-menu (the titan line-up). Fights
   * launched from the sub-menu return to it.
   */
  menuPage: 'main' | 'campaign';
  /** Which arcade titan is being fought while mode === 'campaign' (0-based). */
  campaignStage: number;
  /**
   * How the campaign is being played: one titan ('single'), the timed
   * back-to-back GAUNTLET RUN (health refills between titans), or HARDCORE
   * (same run, no healing).
   */
  campaignMode: 'single' | 'gauntlet' | 'hardcore';
  /** Network side: 0 = host (match authority), 1 = guest. */
  side: 0 | 1;
  /** Human-readable connection status for the lobby info panel. */
  netStatus: string;
  /** Aim Training option: targets shoot back so you can train dodging. */
  shootBack: boolean;
  stats: LifetimeStats;
} = {
  state: 'menu',
  mode: 'bot',
  menuPage: 'main',
  campaignStage: 0,
  campaignMode: 'single',
  side: 0,
  netStatus: 'not connected',
  shootBack: localStorage.getItem('ff-shootback') !== '0',
  stats: loadStats(),
};

/** An arcade stage is open once every stage before it has been cleared. */
export function stageUnlocked(stage: number): boolean {
  if (stage <= 0) return true;
  return app.stats.campaignCleared[stage - 1] === true;
}

/** The gauntlet run opens once every titan has been felled at least once. */
export function gauntletUnlocked(): boolean {
  return app.stats.campaignCleared.every((c) => c === true);
}

export function saveStats(): void {
  try {
    localStorage.setItem('ff-stats', JSON.stringify(app.stats));
  } catch {
    /* storage unavailable — stats stay in-memory */
  }
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
