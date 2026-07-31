/**
 * Firebase-backed leaderboards, riding the same Firestore project that does
 * matchmaking (collection `players`, one doc per anonymous player id).
 *
 * Two boards:
 *  - 1V1: ranks SCORE — a real win banks a flat +20, a practice win over the
 *    bot a token +2; losers lose NOTHING. A HIDDEN per-player ELO (K=32) still
 *    moves on every REAL result (rival-quality signal for matchmaking) but no
 *    longer weights the score, and the bot has no rating to move.
 *  - AIM TRAINING: personal-best run scores.
 *
 * Identity is a localStorage uuid with a derived IRON-XXXX callsign — no
 * sign-in. Firestore + firebase/app load lazily so lobby/bot players who
 * never go online don't pay for the bundle. Needs Firestore rules opening
 * the `players` collection (same hackathon-grade shape as `lobbies`).
 */

import { FIREBASE_ENABLED, firebaseConfig } from './firebaseConfig.js';
import { xpForArcade, xpForBot, xpForCampaign, xpForMatch, xpForTraining, xpForTutorial } from '../menu/progression.js';
import { addCoins } from '../menu/wallet.js';
import { CURRENCY, LADDER, seasonIndex, seasonScoreField, type ArcadeMode, type Difficulty } from '../config.js';

export interface LbRow {
  /** The player's doc id — identifies them when their row is clicked. */
  uid: string;
  name: string;
  value: number;
  /** This row is YOU — the UI highlights it. */
  me: boolean;
  /** Cumulative XP — drives the rank badge on every board + the profile. */
  xp: number;
  /** RANKED ladder points, for the profile card. (Raw ELO is a hidden
   *  matchmaking signal and never leaves this module for display.) */
  score: number;
  /** Season honours: counts per trophy — first/second/third/top10/top25. */
  awards: Partial<Record<SeasonAward, number>>;
  /** Highest campaign-gauntlet clear: 0 none · 1 normal · 2 hard · 3 blazing. */
  gauntletBest: number;
  /** Highest gauntlet clear done HARDCORE (same tiers) — when it matches the
   *  badge's tier, the profile glyph burns red. */
  gauntletBestHc: number;
  /** Highest raid clear, same tiers. */
  raidBest: number;
  /** Highest hardcore raid clear. */
  raidBestHc: number;
  /** Highest GOOPLIATH-raid clear, same tiers. (The tide has no hardcore —
   *  one long fight — so the drop never reddens.) */
  goopBest: number;
  /** The player's self-written note, shown on their profile. */
  note: string;
}

/** The season-end honours, best first. */
export type SeasonAward = 'first' | 'second' | 'third' | 'top10' | 'top25';
export const SEASON_AWARDS: SeasonAward[] = ['first', 'second', 'third', 'top10', 'top25'];

/** The score boards (BATTLE's 1v1 / 2v2 / ffa, XP), the ARCADE boards (AIM
 *  training plus the two PvE RUN-TIME boards) and a synthetic PROFILE face. */
export type LeaderboardTab =
  | 'ranked'
  | 'xp'
  | 'training'
  | 'duo'
  | 'ffa'
  | 'gauntlet'
  | 'raid'
  | 'goopliath'
  | 'profile';
/** Score/count boards (one numeric value per PLAYER doc). */
type DataTab = 'ranked' | 'xp' | 'training' | 'duo' | 'ffa';
/** RUN-TIME boards — each row is one completed RUN (a squad + a clock), not a
 *  player. Ranked by lowest cumulative fight time. One board per mode —
 *  GOOPLIATH raids race their own clock (one long fight is a different race
 *  from a five-titan run, so they never share a board with titan raids).
 *  Hardcore and higher difficulties ride their board wearing symbols; EASY
 *  runs never rank at all. */
export type RunTab = 'gauntlet' | 'raid' | 'goopliath';
const RUN_TABS: RunTab[] = ['gauntlet', 'raid', 'goopliath'];
/** Firestore collection per run board (separate collections keep the query a
 *  plain single-field orderBy — no composite index needed). The old
 *  runHardcore / runRaidHardcore collections are retired — hardcore runs now
 *  post here with their `hardcore` flag. */
const RUN_COLLECTION: Record<RunTab, string> = {
  gauntlet: 'runGauntlet',
  raid: 'runRaid',
  goopliath: 'runGoopliath',
};

/** One entry on a run board: the whole squad (one name for a solo gauntlet,
 *  up to five for a raid), the run's cumulative fight-time clock, and the
 *  feat's markers (difficulty + hardcore) for the row symbols. */
export interface RunRow {
  names: string[];
  seconds: number;
  /** 'normal' | 'hard' | 'blazing' (legacy rows read as normal). */
  difficulty: Difficulty;
  hardcore: boolean;
  /** My callsign is on this run — the UI highlights it. */
  me: boolean;
}

const LEADERBOARD_FETCH_LIMIT = 50;
/** Rows the lobby board shows at once — the full top 10, no scrolling needed
 *  to take in the ladder; ranks 11+ (up to the fetch limit) reveal on scroll.
 *  The menu panel imports this so what's drawn and what scroll clamps to agree. */
export const LEADERBOARD_VISIBLE_ROWS = 10;

/** Live leaderboard state the lobby panel reads each redraw. */
export const leaderboard = {
  // PROFILE is the panel's landing face — your own card first, boards a tap away.
  tab: 'profile' as LeaderboardTab,
  ranked: [] as LbRow[],
  xp: [] as LbRow[],
  training: [] as LbRow[],
  duo: [] as LbRow[],
  ffa: [] as LbRow[],
  gauntlet: [] as RunRow[],
  raid: [] as RunRow[],
  goopliath: [] as RunRow[],
  scroll: {
    ranked: 0,
    xp: 0,
    training: 0,
    duo: 0,
    ffa: 0,
    gauntlet: 0,
    raid: 0,
    goopliath: 0,
  } as Record<DataTab | RunTab, number>,
  status: FIREBASE_ENABLED ? 'loading…' : 'leaderboard offline',
  /** Whose profile the PROFILE face shows; null = your own. */
  viewRow: null as LbRow | null,
};

/** The current rival's claim about themselves (peer `iam` message). */
export const rival = { name: 'RIVAL', elo: 1000, avatarSkin: '', platformSkin: '', avColor: -1, avLight: 0.5 };

const ELO_K = 32;

const profile = {
  id: '',
  name: '',
  score: 0, // the CURRENT season's ladder points
  elo: 1000,
  training: 0,
  duo: 0,
  ffa: 0,
  xp: 0,
  note: '',
  awards: {} as Partial<Record<SeasonAward, number>>,
  /** Last season index whose final standings we've claimed honours for. */
  awardedThrough: 0,
  gauntletBest: 0,
  gauntletBestHc: 0,
  raidBest: 0,
  raidBestHc: 0,
  goopBest: 0,
};

/** Your own profile as a board row (for the PROFILE face when viewing self). */
export function myProfileRow(): LbRow {
  return {
    uid: profile.id,
    name: profile.name,
    value: profile.score,
    me: true,
    xp: profile.xp,
    score: profile.score,
    awards: profile.awards,
    gauntletBest: profile.gauntletBest,
    gauntletBestHc: profile.gauntletBestHc,
    raidBest: profile.raidBest,
    raidBestHc: profile.raidBestHc,
    goopBest: profile.goopBest,
    note: profile.note,
  };
}

export function myNote(): string {
  return profile.note;
}

/** Save the typed profile note — sanitised to the keyboard alphabet, max 48. */
export function setPlayerNote(raw: string): void {
  const note = raw.replace(/[^A-Z0-9\- ]/gi, '').replace(/\s+/g, ' ').trim().slice(0, 48);
  profile.note = note;
  writeMine({ note });
  if (leaderboard.viewRow?.me) leaderboard.viewRow.note = note;
  void refreshLeaderboard(true);
}

function isDataTab(tab: LeaderboardTab): tab is DataTab {
  return tab === 'ranked' || tab === 'xp' || tab === 'training' || tab === 'duo' || tab === 'ffa';
}

export function isRunTab(tab: LeaderboardTab): tab is RunTab {
  return tab === 'gauntlet' || tab === 'raid' || tab === 'goopliath';
}

export function leaderboardRows(tab: LeaderboardTab = leaderboard.tab): LbRow[] {
  return isDataTab(tab) ? leaderboard[tab] : [];
}

/** The rows of a run board (empty for any non-run tab). */
export function runRows(tab: LeaderboardTab = leaderboard.tab): RunRow[] {
  return isRunTab(tab) ? leaderboard[tab] : [];
}

/** Rows currently on the active board — either shape, for scroll clamping. */
function activeRowCount(tab: LeaderboardTab): number {
  if (isDataTab(tab)) return leaderboard[tab].length;
  if (isRunTab(tab)) return leaderboard[tab].length;
  return 0;
}

/** Current scroll offset for the active board (0 on the profile face). */
export function boardScroll(): number {
  const t = leaderboard.tab;
  return isDataTab(t) || isRunTab(t) ? leaderboard.scroll[t] : 0;
}

export function clampLeaderboardScroll(tab: DataTab | RunTab): void {
  const max = Math.max(0, activeRowCount(tab) - LEADERBOARD_VISIBLE_ROWS);
  leaderboard.scroll[tab] = Math.max(0, Math.min(max, leaderboard.scroll[tab]));
}

/** Index of MY first (best) row on a board — −1 when I'm not on it. */
function myRowIndex(tab: DataTab | RunTab): number {
  const rows: Array<{ me: boolean }> = leaderboard[tab];
  return rows.findIndex((r) => r.me);
}

export function setLeaderboardTab(tab: LeaderboardTab): void {
  leaderboard.tab = tab;
  if (isDataTab(tab) || isRunTab(tab)) {
    // Open WHERE YOU ARE: a board you've scored on lands scrolled to your row
    // (a few ranks of context above it), not to a top 10 you may not be in.
    // Inside the top 10 (or off the board) it opens at the top as ever, and
    // the jump only happens on the SWITCH — scrolling after that is yours.
    const mine = myRowIndex(tab);
    leaderboard.scroll[tab] = mine >= 0 ? Math.max(0, mine - 4) : 0;
    clampLeaderboardScroll(tab);
  }
}

/** Open a player's profile face (null = your own). */
export function setProfileView(row: LbRow | null): void {
  leaderboard.viewRow = row;
  leaderboard.tab = 'profile';
}

export function scrollLeaderboard(delta: number): boolean {
  const tab = leaderboard.tab;
  if (!isDataTab(tab) && !isRunTab(tab)) return false;
  const before = leaderboard.scroll[tab];
  leaderboard.scroll[tab] += delta;
  clampLeaderboardScroll(tab);
  return leaderboard.scroll[tab] !== before;
}

export function myName(): string {
  return profile.name;
}

export function myElo(): number {
  return profile.elo;
}

/** My own board numbers, for the panel footer. */
export function myStats(): { name: string; score: number; training: number; xp: number; elo: number } {
  return {
    name: profile.name,
    score: profile.score,
    training: profile.training,
    xp: profile.xp,
    elo: profile.elo,
  };
}

function localId(): string {
  try {
    let id = localStorage.getItem('ff-player-id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('ff-player-id', id);
    }
    return id;
  } catch {
    return crypto.randomUUID(); // storage unavailable — session-only identity
  }
}

/** Has this player typed a callsign yet? (Keyboard pops only while false.) */
export function hasCustomName(): boolean {
  try {
    return !!localStorage.getItem('ff-player-name');
  } catch {
    return true; // storage broken — never nag
  }
}

/**
 * Save the typed callsign — once, shared by BOTH boards (training submits
 * and 1v1s). Sanitised to the keyboard's own alphabet, max 12 chars.
 */
export function setPlayerName(raw: string): void {
  const name = raw.replace(/[^A-Z0-9\- ]/gi, '').trim().toUpperCase().slice(0, 12);
  if (!name) return;
  try {
    localStorage.setItem('ff-player-name', name);
    // When the player typed THIS name — a rename filed for the account on the
    // doc (renameTo/renameAt, below) only wins over a local name that is
    // OLDER than the filing.
    localStorage.setItem('ff-player-name-at', String(Date.now()));
  } catch {
    /* keep it for this session at least */
  }
  profile.name = name;
  writeMine({}); // writeMine always carries the name
  void refreshLeaderboard(true);
}

type FirestoreMod = typeof import('firebase/firestore');
interface Handle {
  fs: FirestoreMod;
  db: import('firebase/firestore').Firestore;
}

let handlePromise: Promise<Handle | null> | null = null;

function firestore(): Promise<Handle | null> {
  if (!FIREBASE_ENABLED) return Promise.resolve(null);
  handlePromise ??= (async () => {
    try {
      const appMod = await import('firebase/app');
      const fs = await import('firebase/firestore');
      // The WebRTC transport may have initialised the app already (or will
      // after us) — share the instance instead of double-initialising.
      const fbApp = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
      return { fs, db: fs.getFirestore(fbApp) };
    } catch {
      leaderboard.status = 'leaderboard offline';
      return null;
    }
  })();
  return handlePromise;
}

// Becomes true once the boot load has settled (doc fetched, created, or the
// attempt failed) — so `profile.xp` is real, not the pre-load 0. The promotion
// celebration waits for this before baselining, or a cloud load looks like an
// instant promotion on every login.
let loaded = false;

/** Has the boot profile load settled? (XP is real, not the pre-load 0.) */
export function profileReady(): boolean {
  return loaded;
}

/** Load (or create) my player doc, then pull both boards. Call once at boot. */
export function initLeaderboard(): void {
  profile.id = localId();
  let stored: string | null = null;
  try {
    stored = localStorage.getItem('ff-player-name');
  } catch {
    /* fall through to the derived callsign */
  }
  profile.name = stored ?? `IRON-${profile.id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
  void (async () => {
    const h = await firestore();
    if (!h) {
      loaded = true; // no cloud — local-only play, baseline off the current XP
      return;
    }
    try {
      const ref = h.fs.doc(h.db, 'players', profile.id);
      const snap = await h.fs.getDoc(ref);
      const season = seasonIndex();
      if (snap.exists()) {
        const d = snap.data();
        // Ladder points are PER SEASON: read the live season's bank. A new
        // season SOFT-RESETS — your previous final carries over capped at
        // LADDER.seasonCarryCap, so the summit restarts within reach (season
        // 1 seeds from the pre-season lifetime score the same way). The doc
        // self-migrates so the season board sees the old guard.
        const banked = d[seasonScoreField(season)] as number | undefined;
        const prevFinal =
          season === 1 ? ((d.score as number) ?? 0) : ((d[seasonScoreField(season - 1)] as number) ?? 0);
        profile.score = banked ?? Math.min(LADDER.seasonCarryCap, prevFinal);
        if (banked === undefined && profile.score > 0) {
          writeMine({ [seasonScoreField(season)]: profile.score, score: profile.score });
        }
        // INACTIVITY DECAY, applied lazily: every full decayDays-block since
        // the last ranked bout hands back decayLp (floored at 0). The anchor
        // advances by exactly the blocks charged, so idle time never
        // double-bills and a mid-block return keeps its partial credit.
        {
          const dayMs = 86_400_000;
          let anchor = (d.lastPlayedAt as number) ?? 0;
          if (!anchor) {
            anchor = Date.now();
            writeMine({ lastPlayedAt: anchor });
          }
          const blocks = Math.floor((Date.now() - anchor) / (LADDER.decayDays * dayMs));
          if (blocks > 0) {
            profile.score = Math.max(0, profile.score - blocks * LADDER.decayLp);
            writeMine({
              [seasonScoreField(season)]: profile.score,
              score: profile.score,
              lastPlayedAt: anchor + blocks * LADDER.decayDays * dayMs,
            });
          }
        }
        profile.elo = (d.elo as number) ?? 1000;
        profile.training = (d.training as number) ?? 0;
        profile.duo = (d.duo as number) ?? 0;
        profile.ffa = (d.ffa as number) ?? 0;
        profile.xp = (d.xp as number) ?? 0;
        profile.note = (d.note as string) ?? '';
        profile.awards = (d.awards as Partial<Record<SeasonAward, number>>) ?? {};
        profile.awardedThrough = (d.awardedThrough as number) ?? season - 1;
        profile.gauntletBest = (d.gauntletBest as number) ?? 0;
        profile.gauntletBestHc = (d.gauntletBestHc as number) ?? 0;
        profile.raidBest = (d.raidBest as number) ?? 0;
        profile.raidBestHc = (d.raidBestHc as number) ?? 0;
        profile.goopBest = (d.goopBest as number) ?? 0;
        // A rename FILED FOR this account rides `renameTo`/`renameAt` — doc
        // fields the client's ordinary writes never touch, so a correction
        // survives however many times an old build's name re-sync (below)
        // stamps the stale callsign back over `name`. Adopt it unless the
        // player has typed a NEWER name themselves. (This is what lets a
        // rename be repaired server-side at all: `name` alone can't carry a
        // correction, because every client write re-asserts the local name.)
        {
          const renameTo = d.renameTo as string | undefined;
          const renameAt = (d.renameAt as number) ?? 0;
          let localAt = 0;
          try {
            localAt = parseInt(localStorage.getItem('ff-player-name-at') ?? '0', 10) || 0;
          } catch {
            /* no stamp readable — treat the local name as old */
          }
          if (renameTo && renameTo !== profile.name && localAt < renameAt) {
            profile.name = renameTo;
            try {
              localStorage.setItem('ff-player-name', renameTo);
              localStorage.setItem('ff-player-name-at', String(Date.now()));
            } catch {
              /* session-only adoption — re-adopts next boot */
            }
          }
        }
        // A locally renamed player syncs the doc's stale callsign.
        if ((d.name as string) !== profile.name) writeMine({});
        // Seasons that closed since our last visit: claim any honours.
        void claimSeasonAwards(season);
      } else {
        profile.awardedThrough = season - 1;
        await h.fs.setDoc(ref, {
          name: profile.name,
          score: 0,
          elo: 1000,
          training: 0,
          duo: 0,
          ffa: 0,
          xp: 0,
          note: '',
          awards: {},
          awardedThrough: season - 1,
          gauntletBest: 0,
          gauntletBestHc: 0,
          raidBest: 0,
          raidBestHc: 0,
          goopBest: 0,
          lastPlayedAt: Date.now(),
          updatedAt: h.fs.serverTimestamp(),
        });
      }
    } catch {
      leaderboard.status = 'leaderboard unreachable';
    }
    loaded = true; // XP is now real (or the load failed) — safe to baseline
    void refreshLeaderboard(true);
  })();
}

let lastFetch = -Infinity;

/** Pull the top rows of both boards (throttled — `force` bypasses). */
export async function refreshLeaderboard(force = false): Promise<void> {
  if (!force && performance.now() - lastFetch < 20_000) return;
  lastFetch = performance.now();
  const h = await firestore();
  if (!h) return;
  const { fs, db } = h;
  try {
    const players = fs.collection(db, 'players');
    const pull = async (field: string): Promise<LbRow[]> => {
      const snap = await fs.getDocs(fs.query(players, fs.orderBy(field, 'desc'), fs.limit(LEADERBOARD_FETCH_LIMIT)));
      return snap.docs
        .map((d) => ({
          uid: d.id,
          name: (d.data().name as string) ?? '???',
          value: (d.data()[field] as number) ?? 0,
          me: d.id === profile.id,
          xp: (d.data().xp as number) ?? 0,
          score: (d.data().score as number) ?? 0,
          awards: (d.data().awards as Partial<Record<SeasonAward, number>>) ?? {},
          gauntletBest: (d.data().gauntletBest as number) ?? 0,
          gauntletBestHc: (d.data().gauntletBestHc as number) ?? 0,
          raidBest: (d.data().raidBest as number) ?? 0,
          raidBestHc: (d.data().raidBestHc as number) ?? 0,
          goopBest: (d.data().goopBest as number) ?? 0,
          note: (d.data().note as string) ?? '',
        }))
        // Every board shows anyone who's banked anything. (RANKED is ladder
        // points now — per-season, and raw ELO stays hidden for matchmaking.)
        .filter((r) => r.value > 0);
    };
    // RUN boards: each is its own collection of finished runs, ranked by the
    // lowest cumulative fight time. A row is a whole squad, so "me" is my
    // callsign appearing anywhere in the run's name list.
    // Each run board is pulled in its OWN try so a missing collection or a
    // rules gap on the run boards degrades THEM alone — the score boards
    // (which hit the known-open `players` collection) keep working.
    const pullRuns = async (tab: RunTab): Promise<RunRow[]> => {
      try {
        const col = fs.collection(db, RUN_COLLECTION[tab]);
        const snap = await fs.getDocs(fs.query(col, fs.orderBy('seconds', 'asc'), fs.limit(LEADERBOARD_FETCH_LIMIT)));
        const rows = snap.docs.map((d) => {
          const names = Array.isArray(d.data().names) ? (d.data().names as unknown[]).map(String) : [];
          return {
            names,
            seconds: (d.data().seconds as number) ?? 0,
            difficulty: ((d.data().difficulty as Difficulty) ?? 'normal') as Difficulty,
            hardcore: !!d.data().hardcore,
            me: names.includes(profile.name),
          };
        });
        // Every finished run is stored, but only a squad's BEST time PER FEAT
        // ranks — the same squad's normal, hard, blazing and hardcore clears
        // are different achievements, so each keeps its own best row. Rows
        // arrive fastest-first, so the first per key is its best.
        //
        // EASY never ranks. reportRun refuses easy runs at write time, but
        // rows posted before that guard existed are immortal (the run
        // collections are append-only by rule), so the board filters them on
        // read too — belt and braces, one line each side.
        const seen = new Set<string>();
        return rows.filter((r) => r.difficulty !== 'easy').filter((r) => {
          const key = `${r.names.map((n) => n.toLowerCase()).sort().join('|')}|${r.difficulty}|${r.hardcore ? 'hc' : ''}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      } catch {
        return leaderboard[tab]; // keep whatever we last had
      }
    };
    const [rk, xp, tr, du, ff, gt, rd, gp] = await Promise.all([
      pull(seasonScoreField(seasonIndex())), // RANKED: the season in progress
      pull('xp'),
      pull('training'),
      pull('duo'),
      pull('ffa'),
      pullRuns('gauntlet'),
      pullRuns('raid'),
      pullRuns('goopliath'),
    ]);
    leaderboard.ranked = rk;
    leaderboard.xp = xp;
    leaderboard.training = tr;
    leaderboard.duo = du;
    leaderboard.ffa = ff;
    leaderboard.gauntlet = gt;
    leaderboard.raid = rd;
    leaderboard.goopliath = gp;
    (['ranked', 'xp', 'training', 'duo', 'ffa', ...RUN_TABS] as const).forEach(clampLeaderboardScroll);
    leaderboard.status = '';
  } catch {
    leaderboard.status = 'leaderboard unreachable';
  }
}

/**
 * Post a finished RUN to its board: one entry per completed run, ranked by the
 * lowest cumulative fight-time clock. `names` is the whole squad (one name for
 * a solo gauntlet/hardcore, up to four for a raid — the raid HOST posts it once
 * for the group so the squad ranks together on their run). No-op offline.
 */
export function reportRun(tab: RunTab, seconds: number, names: string[], difficulty: Difficulty, hardcore: boolean): void {
  if (difficulty === 'easy') return; // easy runs play, but never rank
  const clean = names.map((n) => String(n).slice(0, 12)).filter(Boolean).slice(0, 5);
  if (!clean.length) return;
  void (async () => {
    const h = await firestore();
    if (!h) return;
    try {
      await h.fs.addDoc(h.fs.collection(h.db, RUN_COLLECTION[tab]), {
        names: clean,
        seconds: Math.max(0, Math.round(seconds * 10) / 10),
        difficulty,
        hardcore,
        at: h.fs.serverTimestamp(),
      });
      await refreshLeaderboard(true);
    } catch {
      /* unreachable — the board just won't carry this run */
    }
  })();
}

/** Clear-badge tier per difficulty (easy earns nothing — same as ranking). */
const CLEAR_TIER: Record<Difficulty, number> = { easy: 0, normal: 1, hard: 2, blazing: 3 };

/**
 * A full RUN was WON (gauntlet, titan raid, or Goopliath raid): raise that
 * family's profile badge to this difficulty's tier if it's the best yet.
 * Only the highest tier ever shows on the profile — blazing wears the flame.
 * A HARDCORE clear also raises its own high-water mark; when it matches the
 * badge's tier the glyph burns red. (Goopliath has no hardcore.)
 */
export function reportRunClear(kind: 'gauntlet' | 'raid' | 'goopliath', difficulty: Difficulty, hardcore = false): void {
  const tier = CLEAR_TIER[difficulty];
  const field = kind === 'gauntlet' ? 'gauntletBest' : kind === 'raid' ? 'raidBest' : 'goopBest';
  const patch: Record<string, number> = {};
  if (tier > profile[field]) {
    profile[field] = tier;
    patch[field] = tier;
  }
  if (hardcore && kind !== 'goopliath') {
    const hcField = kind === 'gauntlet' ? 'gauntletBestHc' : 'raidBestHc';
    if (tier > profile[hcField]) {
      profile[hcField] = tier;
      patch[hcField] = tier;
    }
  }
  if (Object.keys(patch).length) writeMine(patch);
}

/**
 * Season honours: every closed season we haven't evaluated yet gets one read
 * of its FROZEN final standings (the per-season score field never moves
 * again once the season ends); a top-25 finish self-awards the trophy.
 * Repeat honours stack — the profile chip shows ×N.
 */
async function claimSeasonAwards(current: number): Promise<void> {
  if (profile.awardedThrough >= current - 1) return;
  const h = await firestore();
  if (!h) return;
  const { fs, db } = h;
  try {
    const players = fs.collection(db, 'players');
    for (let s = Math.max(1, profile.awardedThrough + 1); s < current; s++) {
      const snap = await fs.getDocs(fs.query(players, fs.orderBy(seasonScoreField(s), 'desc'), fs.limit(25)));
      const rank = snap.docs.findIndex((d) => d.id === profile.id) + 1; // 0 = unplaced
      if (rank >= 1) {
        const key: SeasonAward = rank === 1 ? 'first' : rank === 2 ? 'second' : rank === 3 ? 'third' : rank <= 10 ? 'top10' : 'top25';
        profile.awards[key] = (profile.awards[key] ?? 0) + 1;
      }
    }
    profile.awardedThrough = current - 1;
    writeMine({ awards: profile.awards, awardedThrough: profile.awardedThrough });
  } catch {
    /* standings unreachable — we'll try again next launch */
  }
}

function writeMine(fields: Record<string, unknown>): void {
  void (async () => {
    const h = await firestore();
    if (!h) return;
    try {
      await h.fs.setDoc(
        h.fs.doc(h.db, 'players', profile.id),
        { name: profile.name, updatedAt: h.fs.serverTimestamp(), ...fields },
        { merge: true },
      );
    } catch {
      /* unreachable right now — the next result will try again */
    }
  })();
}

/**
 * A finished REAL 1v1: the public LADDER moves — a win pays LADDER.win plus
 * an upset bonus read off the (hidden) rating gap, a loss hands a little
 * back and never drags below zero. The raw ELO itself still moves both ways
 * underneath as the matchmaking signal, but it is never shown anywhere.
 */
export function reportResult(win: boolean, oppElo: number): void {
  // Upset bonus from the PRE-match gap: toppling a giant pays extra, farming
  // rookies pays less — the ladder carries a whiff of skill without the sting.
  const upset = Math.max(LADDER.upsetMin, Math.min(LADDER.upsetMax, Math.round((oppElo - profile.elo) / LADDER.upsetDiv)));
  profile.score = Math.max(0, profile.score + (win ? LADDER.win + upset : -LADDER.loss));
  const expected = 1 / (1 + Math.pow(10, (oppElo - profile.elo) / 400));
  profile.elo = Math.max(100, Math.round(profile.elo + ELO_K * ((win ? 1 : 0) - expected)));
  profile.xp += xpForMatch(win); // every real bout feeds the rank ladder
  addCoins(CURRENCY.perGame); // …and the coin wallet, alongside the XP
  // LP banks into the SEASON field (what the board ranks); `score` mirrors it
  // for older clients and the season seed. A ranked bout also re-anchors the
  // inactivity-decay clock.
  writeMine({
    [seasonScoreField(seasonIndex())]: profile.score,
    score: profile.score,
    elo: profile.elo,
    xp: profile.xp,
    lastPlayedAt: Date.now(),
  });
  void refreshLeaderboard(true);
}

/**
 * A finished quick match vs the BOT: banks XP either way (win 15 / loss 5) so
 * the mode always rewards, plus token ladder points on a win. No ELO movement
 * — the bot has no rating.
 */
export function reportBotResult(win: boolean): void {
  if (win) profile.score += LADDER.botWin;
  profile.xp += xpForBot();
  addCoins(CURRENCY.perGame);
  writeMine({
    [seasonScoreField(seasonIndex())]: profile.score,
    score: profile.score,
    xp: profile.xp,
    lastPlayedAt: Date.now(),
  });
  void refreshLeaderboard(true);
}

/**
 * A finished arcade brawl (2v2 / FFA): bank a flat participation XP either
 * way, and move that mode's LADDER — a win pays (FFA a touch more, it's a
 * one-in-four), a loss hands a little back, floored at zero. Bot brawls pay
 * only the token bot rate on a win — practice charts, it doesn't climb.
 */
export function reportArcade(mode: ArcadeMode, win: boolean, vsBots = false): void {
  profile.xp += xpForArcade();
  addCoins(CURRENCY.perGame);
  const gain = vsBots
    ? win
      ? LADDER.botWin
      : 0
    : win
      ? mode === 'ffa'
        ? LADDER.ffaWin
        : LADDER.brawlWin
      : -LADDER.brawlLoss;
  const fields: Record<string, unknown> = { xp: profile.xp };
  if (mode === '2v2') {
    profile.duo = Math.max(0, profile.duo + gain);
    fields.duo = profile.duo;
  } else if (mode === 'ffa') {
    profile.ffa = Math.max(0, profile.ffa + gain);
    fields.ffa = profile.ffa;
  }
  writeMine(fields);
  void refreshLeaderboard(true);
}

/**
 * A finished ARCADE campaign titan bout. Pays the SAME flat rate as a quick
 * match vs the bot (XP + coins, win or lose) — except the FIRST time each
 * titan is felled, when both pay double. Campaign bouts are offline solo
 * fights, so nothing ticks the online score boards.
 */
export function reportCampaign(win: boolean, firstClear: boolean): void {
  const mult = win && firstClear ? 2 : 1;
  profile.xp += xpForCampaign() * mult;
  addCoins(CURRENCY.perGame * mult);
  writeMine({ xp: profile.xp });
  void refreshLeaderboard(true);
}

/** An Aim Training run ended — bank XP (every run) and a new personal best. */
export function reportTraining(score: number): void {
  const newBest = score > profile.training;
  profile.xp += xpForTraining();
  addCoins(CURRENCY.perGame);
  if (newBest) profile.training = score;
  writeMine({ training: profile.training, xp: profile.xp });
  void refreshLeaderboard(true);
}

/**
 * The tutorial GRADUATION — the one-time welcome payout (the caller guards
 * the one-time part via app.tutorialDone). Win or lose: running the whole
 * thing is the achievement, exactly like the unlock.
 */
export function reportTutorial(): void {
  profile.xp += xpForTutorial();
  addCoins(CURRENCY.tutorial);
  writeMine({ xp: profile.xp });
  void refreshLeaderboard(true);
}

/**
 * File a SAFETY REPORT — the settings-menu "report a problem" flow. The text
 * lands in the 'reports' Firestore collection with the reporter's callsign
 * and stable id attached (so repeat reports correlate and abuse of the box
 * itself is traceable). No addresses live in the client: delivery to a human
 * is the backend's business (read the collection in the console, or bolt the
 * Trigger Email extension onto it). Fire-and-forget — the game never blocks
 * on it, and with no cloud configured it just quietly does nothing.
 */
export async function sendReport(text: string): Promise<void> {
  const trimmed = text.trim().slice(0, 200);
  if (!trimmed) return;
  const h = await firestore();
  if (!h) return;
  try {
    await h.fs.addDoc(h.fs.collection(h.db, 'reports'), {
      text: trimmed,
      from: profile.name,
      uid: profile.id,
      at: h.fs.serverTimestamp(),
    });
  } catch {
    /* offline or rules closed — the report is best-effort */
  }
}
