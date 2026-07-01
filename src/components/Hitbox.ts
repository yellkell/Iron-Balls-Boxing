/**
 * A spherical hit volume. `team` decides what can hurt it: a fireball only
 * damages hitboxes whose team differs from the ball's owner. `owner` points at
 * the entity holding the shared `Health` — so a multi-sphere body
 * (head/chest/pelvis) all drains one pool.
 */

import { createComponent, Types } from '@iwsdk/core';

export const Hitbox = createComponent(
  'Hitbox',
  {
    radius: { type: Types.Float32, default: 0.25 },
    team: { type: Types.Int32, default: 0 },
    /** Entity carrying the Health this hitbox belongs to. */
    owner: { type: Types.Entity, default: null },
    /**
     * Damage multiplier — the arcade titans' weak-point law. 1 = a normal
     * body sphere; 0 = armour (the ball clanks off, no damage); >1 = an
     * exposed weak point. When spheres overlap, the best multiplier wins.
     */
    damageScale: { type: Types.Float32, default: 1 },
  },
  'Spherical hit volume for collision.',
);
