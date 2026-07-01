/**
 * The arena's payroll: SCRAP (currency) and XP land in the lifetime stats when
 * a bout ends. One base rate covers every won fight — the bot, a quick match,
 * or an arcade titan you have already felled. The FIRST time each titan goes
 * down the payout is doubled; losses everywhere pay the same consolation.
 */

import { app, saveStats } from '../menu/appState.js';
import { REWARDS } from '../config.js';

export interface Payout {
  scrap: number;
  xp: number;
  /** True when the first-clear multiplier applied. */
  doubled: boolean;
}

function pay(scrap: number, xp: number, doubled: boolean): Payout {
  app.stats.scrap += scrap;
  app.stats.xp += xp;
  saveStats();
  return { scrap, xp, doubled };
}

/** Payout for a normal bout (bot / quick match). Also updates W/L elsewhere. */
export function awardMatch(win: boolean): Payout {
  return win
    ? pay(REWARDS.winScrap, REWARDS.winXp, false)
    : pay(REWARDS.lossScrap, REWARDS.lossXp, false);
}

/** Payout for an arcade stage: double on the first clear, base on replays. */
export function awardCampaign(stage: number, win: boolean): Payout {
  if (!win) return pay(REWARDS.lossScrap, REWARDS.lossXp, false);
  const first = app.stats.campaignCleared[stage] !== true;
  if (first) app.stats.campaignCleared[stage] = true;
  const mult = first ? REWARDS.firstClearMult : 1;
  return pay(REWARDS.winScrap * mult, REWARDS.winXp * mult, first);
}

/** Boxer level from lifetime XP — a gentle square-root curve. */
export function playerLevel(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 120)) + 1;
}
