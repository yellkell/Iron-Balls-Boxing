/**
 * The leaderboards. Two boards read from the `players` Firestore collection:
 *   - QUICK   — everyone, ranked by cumulative XP (the Bronze→Overlord climb).
 *   - RANKED  — non-provisional players, ranked by ELO.
 *
 * Reads only — no writes, no Cloud Functions. Queries are single-field
 * `orderBy`s (auto-indexed), so there are no composite indexes to create. The
 * lobby calls `fetchBoard` when a board tab is opened; results are cached
 * briefly and the panel redraws them in on its normal cadence.
 *
 * Degrades like the rest: if Firebase is off/blocked, the board shows an
 * "unavailable" note and the game is unaffected.
 */

import { FIREBASE_ENABLED, firebaseConfig } from './firebaseConfig.js';

export type BoardKind = 'quick' | 'ranked';

export interface BoardRow {
  uid: string;
  name: string;
  value: number;
}

interface DocLike {
  id: string;
  data(): Record<string, unknown>;
}

export const board: {
  quick: BoardRow[];
  ranked: BoardRow[];
  loading: boolean;
  error: string;
  fetchedAt: Record<BoardKind, number>;
} = {
  quick: [],
  ranked: [],
  loading: false,
  error: '',
  fetchedAt: { quick: 0, ranked: 0 },
};

const TTL_MS = 20_000;
const TOP_N = 9;

/** Load (or refresh) a board. Cheap to call repeatedly — caches for ~20 s. */
export async function fetchBoard(kind: BoardKind): Promise<void> {
  if (!FIREBASE_ENABLED) {
    board.error = 'offline';
    return;
  }
  const now = Date.now();
  if (board[kind].length && now - board.fetchedAt[kind] < TTL_MS) return;

  board.loading = true;
  board.error = '';
  try {
    const [appMod, fs] = await Promise.all([import('firebase/app'), import('firebase/firestore')]);
    const fbApp = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
    const players = fs.collection(fs.getFirestore(fbApp), 'players');

    if (kind === 'quick') {
      const snap = await fs.getDocs(fs.query(players, fs.orderBy('xp', 'desc'), fs.limit(TOP_N)));
      board.quick = snap.docs.map((d: DocLike) => toRow(d, 'xp'));
    } else {
      // Over-fetch and drop provisional players client-side, so no composite
      // (placementsLeft == 0) + (orderBy elo) index is needed.
      const snap = await fs.getDocs(fs.query(players, fs.orderBy('elo', 'desc'), fs.limit(TOP_N * 3)));
      board.ranked = snap.docs
        .filter((d: DocLike) => ((d.data().placementsLeft as number) ?? 99) <= 0)
        .slice(0, TOP_N)
        .map((d: DocLike) => toRow(d, 'elo'));
    }
    board.fetchedAt[kind] = now;
  } catch {
    board.error = 'leaderboard unavailable';
  } finally {
    board.loading = false;
  }
}

function toRow(d: DocLike, field: string): BoardRow {
  const data = d.data();
  const name = typeof data.displayName === 'string' && data.displayName ? data.displayName : 'Boxer';
  const value = typeof data[field] === 'number' ? (data[field] as number) : 0;
  return { uid: d.id, name, value };
}
