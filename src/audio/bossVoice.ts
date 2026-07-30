/**
 * Boss entrance voice lines — the same "prefers a real file but never
 * depends on one" law as the pub signs. Each boss looks for its line at
 * `voice/<name>.m4a` (lowercased boss name, e.g. voice/rusthook.m4a in
 * public/voice/); drop the audio in and redeploy — no code change, the
 * titan just starts talking. While a boss has no file, the intro keeps its
 * roar, so a missing line is never a silent name card.
 *
 * The line fires on the NAME CARD beat of the intro ceremony and replaces
 * the roar there. Keep recordings ~2.5–3.5s: the run intro holds the card
 * 1.3s + FIGHT 0.6s, so anything longer bleeds over the opening bell (a
 * second or so of bleed is fine — the first telegraph lands later).
 *
 * Playback rides the SFX volume knob (it's diegetic arena noise, not
 * music). CampaignSystem preloads at stage setup so the file has the whole
 * klaxon + rise (1.9–3.8s) to arrive before its cue. Decoded + played
 * through Web Audio — an audible HTMLAudioElement crashes Meta's Oculus
 * Browser (see musicPlayer.ts), and a voice line long enough to activate
 * the media session would take the whole app down with it.
 */

import { audioContext, sfxVolume } from './sfx.js';

const VOLUME = 0.9; // over the sfx knob — the one voice in the arena, let it carry

type Slot = { buffer: AudioBuffer | null; state: 'loading' | 'ready' | 'missing' };
const slots = new Map<string, Slot>();

function slotFor(name: string): Slot {
  const key = name.toLowerCase();
  let slot = slots.get(key);
  if (!slot) {
    slot = { buffer: null, state: 'loading' };
    slots.set(key, slot);
    const ctx = audioContext();
    if (!ctx) {
      slot.state = 'missing';
      return slot;
    }
    fetch(`voice/${key}.m4a`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.arrayBuffer();
      })
      .then((bytes) => ctx.decodeAudioData(bytes))
      .then((buffer) => {
        slot!.buffer = buffer;
        slot!.state = 'ready';
      })
      .catch(() => {
        slot!.state = 'missing';
      });
  }
  return slot;
}

/** Start fetching a boss's line so it's decoded before the name card. */
export function preloadBossVoice(name: string): void {
  slotFor(name);
}

/**
 * Play the boss's entrance line if its file made it here in time. Returns
 * whether a line is playing — false means "keep the roar" (missing file, or
 * still in flight; better the roar than a card with nothing under it).
 */
export function playBossVoice(name: string): boolean {
  const slot = slotFor(name);
  const ctx = audioContext();
  if (slot.state !== 'ready' || !slot.buffer || !ctx) return false;
  if (ctx.state === 'suspended') void ctx.resume();
  const gain = ctx.createGain();
  gain.gain.value = Math.min(1, VOLUME * sfxVolume());
  gain.connect(ctx.destination);
  const source = ctx.createBufferSource();
  source.buffer = slot.buffer;
  source.connect(gain);
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
  };
  source.start();
  return true;
}
