/**
 * Pub social safety state: who YOU have muted or blocked, persisted across
 * sessions. Keyed by CALLSIGN (lowercased) — the one stable handle we have
 * for a punter across visits (connection ids are per-session).
 *
 *   MUTE  — you stop hearing their voice; they stay visible.
 *   BLOCK — mute plus their avatar and name tag vanish for you.
 *
 * Both are strictly LOCAL (nothing goes over the wire); SocialSystem owns the
 * A-button panel that toggles them, PubPlayerSystem applies them per frame.
 */

function load(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return new Set((JSON.parse(raw) as string[]).map((n) => n.toLowerCase()));
  } catch {
    /* fresh slate */
  }
  return new Set();
}

function save(key: string, set: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* session-only */
  }
}

const muted = load('ff-pub-muted');
const blocked = load('ff-pub-blocked');

const keyOf = (name: string): string => name.trim().toLowerCase();

export function socialMuted(name: string): boolean {
  return muted.has(keyOf(name));
}

export function socialBlocked(name: string): boolean {
  return blocked.has(keyOf(name));
}

export function toggleSocialMute(name: string): void {
  const k = keyOf(name);
  if (!k) return;
  if (muted.has(k)) muted.delete(k);
  else muted.add(k);
  save('ff-pub-muted', muted);
}

export function toggleSocialBlock(name: string): void {
  const k = keyOf(name);
  if (!k) return;
  if (blocked.has(k)) blocked.delete(k);
  else blocked.add(k);
  save('ff-pub-blocked', blocked);
}
