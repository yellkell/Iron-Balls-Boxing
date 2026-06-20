/**
 * The matched opponent's ladder identity, learned from their one-shot `hello`
 * at the start of a bout. Each client settles its OWN ranked ELO against this
 * rating when the match ends, so a quick player and a ranked player can share
 * one queue and bank the result by their own selection.
 *
 * `known` stays false until their hello arrives (or for an older client that
 * never sends one) — callers skip the ELO update in that case rather than
 * rating against a guessed number.
 */

import { ELO_START } from '../progression/progression.js';

export const peer = {
  known: false,
  elo: ELO_START,
  name: '',
};

export function setPeer(elo: number, name: string): void {
  peer.known = true;
  peer.elo = elo;
  peer.name = name;
}

export function resetPeer(): void {
  peer.known = false;
  peer.elo = ELO_START;
  peer.name = '';
}
