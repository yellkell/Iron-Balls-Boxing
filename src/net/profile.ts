/**
 * Player profile: Anonymous Auth identity + the Firestore `players/{uid}` doc
 * that is the cloud source of truth for XP/tier (and, in Phase 3, ELO). It
 * loads lazily, reconciles with the localStorage cache, and pushes local
 * changes back up (debounced) whenever stats change.
 *
 * Degrades gracefully: if Firebase is disabled, offline, or Anonymous sign-in
 * isn't enabled in the console yet, the game stays fully playable on the local
 * cache and simply doesn't sync (`app.profile.synced` stays false).
 *
 * Console prerequisite (one-time): in the Firebase project, enable
 * Authentication → Sign-in method → Anonymous, and allow the signed-in user to
 * read/write their own player doc:
 *
 *   match /players/{uid} {
 *     allow read: if true;                       // leaderboards are public
 *     allow write: if request.auth.uid == uid;   // you own your row
 *   }
 */

import { app, saveStats, setStatsListener } from '../menu/appState.js';
import { FIREBASE_ENABLED, firebaseConfig } from './firebaseConfig.js';

let started = false;

/** Sign in anonymously and bring the cloud profile online. Safe to call once. */
export async function initProfile(): Promise<void> {
  if (started || !FIREBASE_ENABLED) return;
  started = true;

  try {
    const [appMod, authMod, fs] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
    ]);

    // Reuse the [DEFAULT] app if the matchmaking transport already created it.
    const fbApp = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
    const auth = authMod.getAuth(fbApp);
    const cred = await authMod.signInAnonymously(auth);
    const uid = cred.user.uid;

    const db = fs.getFirestore(fbApp);
    const ref = fs.doc(db, 'players', uid);
    const snap = await fs.getDoc(ref);

    app.profile.uid = uid;
    if (!app.profile.displayName) app.profile.displayName = defaultName(uid);

    if (snap.exists()) mergeFromCloud(snap.data() as Record<string, unknown>);
    // Write the reconciled state up (creates the row if it's new).
    await fs.setDoc(ref, payload(), { merge: true });
    app.profile.synced = true;

    // From now on, every stats change pushes to the cloud, debounced.
    setStatsListener(
      debounce(() => {
        void fs.setDoc(ref, payload(), { merge: true }).catch(() => {});
      }, 1500),
    );
  } catch {
    // Anonymous sign-in not enabled / offline / blocked — local-only.
    app.profile.synced = false;
  }
}

function defaultName(uid: string): string {
  return `Boxer-${uid.slice(0, 4).toUpperCase()}`;
}

/** Cloud reconcile: monotonic stats take the higher of local vs cloud. */
function mergeFromCloud(data: Record<string, unknown>): void {
  const has = (k: string): boolean => typeof data[k] === 'number' && Number.isFinite(data[k] as number);
  const num = (k: string): number => (has(k) ? (data[k] as number) : 0);
  const s = app.stats;
  // Monotonic stats take the higher of local vs cloud.
  s.xp = Math.max(s.xp, num('xp'));
  s.wins = Math.max(s.wins, num('wins'));
  s.losses = Math.max(s.losses, num('losses'));
  s.trainingBest = Math.max(s.trainingBest, num('trainingBest'));
  s.rankedWins = Math.max(s.rankedWins, num('rankedWins'));
  s.rankedLosses = Math.max(s.rankedLosses, num('rankedLosses'));
  // ELO is not monotonic — the cloud is authoritative; fewer placements wins.
  if (has('elo')) s.elo = num('elo');
  if (has('placementsLeft')) s.placementsLeft = Math.min(s.placementsLeft, num('placementsLeft'));
  if (typeof data.displayName === 'string' && data.displayName) {
    app.profile.displayName = data.displayName;
  }
  saveStats(); // refresh the local cache with the merged numbers
}

function payload(): Record<string, unknown> {
  const s = app.stats;
  return {
    displayName: app.profile.displayName,
    xp: s.xp,
    wins: s.wins,
    losses: s.losses,
    trainingBest: s.trainingBest,
    elo: s.elo,
    placementsLeft: s.placementsLeft,
    rankedWins: s.rankedWins,
    rankedLosses: s.rankedLosses,
    updatedAt: Date.now(),
  };
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}
