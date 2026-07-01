/**
 * Live ARCADE bout state shared across systems: CampaignSystem writes it,
 * FireballSystem reads the aim-assist point (a titan's sweet spot moves —
 * head when the core is shuttered, the vented core when it's open — and it
 * sits far higher than a human boxer's chest).
 */

import { Vector3 } from 'three';
import { ARENA_GAP } from '../config.js';

export const campaign = {
  /** World point player throws are aim-assisted toward during a titan bout. */
  aimPoint: new Vector3(0, 1.25, -ARENA_GAP),
  /** True while the titan's core is vented open (the punish window). */
  coreOpen: false,
};
