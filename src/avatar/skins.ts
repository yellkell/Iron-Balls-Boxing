/**
 * Pickable skins for the avatar and the platform — pure visuals, applied by
 * recolouring role-tagged materials (boxer.ts / arena.ts tag every material
 * with `userData.role`). Hitboxes are never touched: the PANTHER silhouette
 * slims the chest/pelvis GROUP scales only, the BODY_IK spheres stay as-is.
 *
 * Three launch skins per slot (blue / red / one more) plus a locked
 * COMING SOON chip. The rival's picks arrive in the `iam` message and are
 * applied to their rig/pad; bot bouts keep the team-blue default look.
 */

import { Color, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { PALETTE } from '../config.js';

export interface AvatarSkin {
  id: string;
  name: string;
  locked?: boolean;
  /** Panel steel. */
  chassis: number;
  /** Dark trim pieces. */
  trim: number;
  /** Visor / reactor / trim glow. */
  accent: number;
  /** Sleeker silhouette (visual group scale only — hitboxes untouched). */
  slim?: boolean;
  /** Shop price in coins. Omitted = free / owned from the start. */
  price?: number;
}

export interface PlatformSkin {
  id: string;
  name: string;
  locked?: boolean;
  /** Neon rim piping + slab emissive tint. */
  neon: number;
  /**
   * Shop price in coins (the bolt-dollar currency). Omitted = free / owned by
   * default (the three launch skins). 100 = a recolour or the premium GOLD
   * RUSH pad (≈10 games of play each).
   */
  price?: number;
  /**
   * Premium platforms repaint the diamond-plate SLAB base too (not just the
   * neon), for a look the plain recolours don't get. Omitted = the default
   * gunmetal steel (DEFAULT_SLAB_TINT).
   */
  slab?: number;
  /**
   * The slab's EMISSIVE tint. The deck normally glows faintly in the neon
   * colour, but over a near-black slab a saturated neon (e.g. VOLT's yellow)
   * washes the whole deck that colour. Set this to keep the deck truly black
   * (0x000000) while the rim + any decal still burn the neon. Omitted = neon.
   */
  slabEmissive?: number;
  /** Stronger deck bloom for rare earned pads; ordinary steel rests at 0.08. */
  slabGlow?: number;
  /**
   * Deck roughness. Steel sits at DEFAULT_SLAB_ROUGH; a POLISHED pad wants a
   * little less, because on a metal surface part of the read of "precious" is
   * specular — gold at steel's roughness is a mustard-coloured floor.
   */
  slabRough?: number;
  /**
   * Deck metalness. Steel sits at DEFAULT_SLAB_METAL (0.92), where the surface
   * takes essentially ALL its colour from what it reflects — which in a dim
   * arena means a gold tint renders as good as black however bright the tint
   * is. Dropping this lets the tint show diffusely, so the pad reads gold in
   * the room it is actually standing in rather than only under a studio light.
   */
  slabMetal?: number;
  /**
   * Earned, never sold: how this skin is won (shown on its shop tile in place
   * of a price; tapping it there does nothing until it's yours). The CHAMPION
   * pad carries 'FELL GOLIATH'.
   */
  earnedBy?: string;
}

/** The makePlatform() slab base tint — restored when a non-premium skin is worn. */
export const DEFAULT_SLAB_TINT = 0x9aa0ab;
/** The makePlatform() slab roughness — restored when a skin sets none. */
export const DEFAULT_SLAB_ROUGH = 0.28;
/** The makePlatform() slab metalness — restored when a skin sets none. */
export const DEFAULT_SLAB_METAL = 0.92;

/** Platform skins owned from the start (no purchase needed). */
export const FREE_PLATFORMS = ['azure', 'inferno', 'ember'];
/** Avatar skins owned from the start — the rest are shop unlocks. */
export const FREE_AVATARS = ['cobalt', 'crimson', 'valkyrie'];

export const AVATAR_SKINS: AvatarSkin[] = [
  // ids are stable (saved prefs + per-skin geometry tags key off them); the
  // display names follow the metallic-animal heads buildBoxer gives each one.
  { id: 'cobalt', name: 'BIGGY', chassis: 0x122039, trim: 0x0a111e, accent: 0x4fb7ff },
  // SHADOW (the panther) wears a slightly slimmer, more feminine silhouette.
  // This is the ONE deliberate exception to "visual matches hitbox": the armour
  // groups scale in, but the BODY_IK hitbox spheres are unchanged, so it's no
  // harder to hit.
  { id: 'crimson', name: 'SHADOW', chassis: 0x2e1013, trim: 0x170809, accent: 0xff3b4e, slim: true },
  // Full silhouette — its visual body matches the shared hitbox.
  { id: 'valkyrie', name: 'FLY GUY', chassis: 0x261b33, trim: 0x120d1a, accent: 0xff9ad5 },
  // Polished steel knight in heraldic gold — a shop unlock.
  { id: 'knight', name: 'KNIGHT', chassis: 0x2d333d, trim: 0x14181f, accent: 0xffcf6e, price: 100 },
  // The stallion: long sculpted muzzle, pricked ears, a swept mane crest and
  // tack-strap cuirass. Derby-green steel with a minted glow.
  { id: 'stallion', name: 'STALLION', chassis: 0x1c2a21, trim: 0x0e1611, accent: 0x53ffa0, price: 500 },
  // The wolf: lean tapered muzzle, pinned-back ears, a snarling scowl and a
  // crescent of moon-embers on the chest. Night-grey steel, cold moonlit glow.
  { id: 'wolf', name: 'KAVIC', chassis: 0x252b34, trim: 0x12161d, accent: 0xa8e0ff, price: 250 },
  // The frog: broad flat head with dome eye-turrets on top, a wide smile
  // line, a throat sac, and a banded belly plate. Pond-green gel-smooth
  // armour with a lily-bright glow.
  { id: 'frog', name: 'LEGS', chassis: 0x1b3a26, trim: 0x0c1d12, accent: 0x86ff70, price: 250 },
  // OSWALD, the lucky rabbit in iron: the biggest head on the roster, the
  // white muzzle mask, big close-set eyes, neon buck teeth, a puff tail, and
  // two TALL STAND-UP ears breaking back near the tip. Black-and-white by
  // design — near-black steel under a bone-white glow, the rubber-hose read.
  // (id stays 'bunny' — it's the save key for owned/worn prefs.)
  { id: 'bunny', name: 'OSWALD', chassis: 0x1b1a1e, trim: 0x0b0b0d, accent: 0xf4f1e4, price: 250 },
];

export const PLATFORM_SKINS: PlatformSkin[] = [
  // The three launch skins — free, owned from the start. SMOULDER (the
  // default) burns your fire's ember over a CHARRED deck — coals, not
  // polish — which also keeps it a room apart from GOLD RUSH's gold-on-gold
  // (the two warm pads used to read as twins on the same gunmetal).
  { id: 'azure', name: 'AZURE', neon: 0x4fb7ff },
  { id: 'inferno', name: 'INFERNO', neon: 0xff3b30 },
  { id: 'ember', name: 'SMOULDER', neon: PALETTE.ember, slab: 0x1a1412 },
  // Shop: two basic recolours…
  { id: 'toxic', name: 'TOXIC', neon: PALETTE.venom, price: 100 },
  { id: 'plasma', name: 'PLASMA', neon: PALETTE.violet, price: 100 },
  // …the fancier premium pad. Gold is a SPECULAR read, not a hue: the old
  // 0xb8902c tint over the diamond-plate map, at steel roughness and washed by
  // a yellow emissive, came out a flat mustard-olive floor with no glint in it
  // at all. A bright bullion tint, a deep warm emissive so the deck stops going
  // olive, and a POLISHED surface so it actually catches the light — plus the
  // struck medallion and border ring built in arena.ts under this id.
  // (Roughness kept near steel's: at 0.1 a metalness-0.92 deck becomes a MIRROR
  // of a mostly dark room and the gold goes black. The read comes from the
  // bright bullion tint plus a warm self-glow, with just a little extra polish.)
  {
    id: 'goldrush',
    name: 'GOLD RUSH',
    neon: 0xffd84a,
    slab: 0xffd071,
    slabEmissive: 0x6b4400,
    slabGlow: 0.26,
    slabRough: 0.26,
    slabMetal: 0.55,
    price: 100,
  },
  // …two more premium repaints. FROSTBITE is FROZEN OVER: glacier piping on a
  // pale rimed deck — the light slab is what keeps it from reading as just
  // AZURE again (both wore blue neon on dark steel and told apart badly).
  { id: 'frostbite', name: 'FROSTBITE', neon: 0x8ae4ff, slab: 0xcfe3ea, slabEmissive: 0x10262e, price: 250 },
  // SYNTHWAVE: hot-pink piping over a midnight-purple deck, plus a raised
  // neon GRID etched across it (built in arena.ts, shown by its skinTag) —
  // the grid is what separates it from PLASMA's plain violet recolour.
  { id: 'synthwave', name: 'SYNTHWAVE', neon: 0xff4fd8, slab: 0x251043, price: 250 },
  // …the storm pad: electric-yellow piping + a big lightning bolt over a
  // jet-black deck (slabEmissive black so the yellow rim doesn't wash the
  // whole deck olive).
  { id: 'volt', name: 'VOLT', neon: 0xffe94a, slab: 0x080808, slabEmissive: 0x000000, price: 1000 },
  // …and the top-shelf flex: a jet-black deck with a big white XD painted on
  // it. slabEmissive black so the white rim doesn't wash the deck grey — the
  // deck reads truly black, like VOLT. The face mesh is built into every
  // platform, tagged with this id and shown only when it's worn.
  { id: 'xdface', name: 'XD', neon: 0xf4f6fb, slab: 0x080808, slabEmissive: 0x000000, price: 5000 },
  // The CHAMPION pad — never sold. Awarded the first time GOLIATH, king of
  // the ARCADE campaign's titan gauntlet, is felled: white-hot piping over a
  // championship-crimson deck.
  { id: 'champion', name: 'CHAMPION', neon: 0xfff3cf, slab: 0x8c2620, earnedBy: 'FELL GOLIATH' },
  // TIDEBREAKER — never sold. Felling GOOPLIATH with a raid squad slicks the
  // deck bottle-green under bright gel piping, GOOPLIATH's pool surging across
  // it with wave crests, bubbles and hanging drips (arena.ts).
  { id: 'tidebreaker', name: 'TIDEBREAKER', neon: 0x5aff7a, slab: 0x0d3f2b, slabGlow: 0.14, earnedBy: 'FELL RAID GOOPLIATH' },
  // BLAZING — never sold. Clear any run or raid on the blazing breaker:
  // fire-red piping over scorched steel, wearing a burning rail, corner flame
  // crowns and airborne embers (arena.ts).
  { id: 'blazing', name: 'BLAZING', neon: 0xff4a26, slab: 0x210605, slabGlow: 0.15, earnedBy: 'WIN ON BLAZING' },
];

/** How the OPPONENT looks when they haven't picked (bot bouts): team blue. */
export const OPPONENT_DEFAULT_AVATAR: AvatarSkin = {
  // id matches the PANTHER tag so an unskinned opponent (the bot) still gets a
  // full animal head — in the default cool-blue team colours.
  id: 'crimson', name: '', chassis: 0x1c1f25, trim: 0x121419, accent: PALETTE.coolFlame,
};
export const OPPONENT_DEFAULT_PLATFORM: PlatformSkin = {
  id: 'opp-default', name: '', neon: PALETTE.coolFlame,
};

export function avatarSkin(id: string): AvatarSkin {
  const s = AVATAR_SKINS.find((x) => x.id === id);
  return s && !s.locked ? s : AVATAR_SKINS[1]; // crimson default
}

export function platformSkin(id: string): PlatformSkin {
  const s = PLATFORM_SKINS.find((x) => x.id === id);
  return s && !s.locked ? s : PLATFORM_SKINS[2]; // ember default
}

/**
 * A cohesive "tinted steel" palette from a single hue (0..1): a dark armour
 * body, a darker trim, and a vivid accent — so one colour repaints the WHOLE
 * suit yet still reads as forged metal lit from within, not a flat fill.
 */
export function colorPalette(hue: number, light = 0.5): { chassis: number; trim: number; accent: number } {
  const h = ((hue % 1) + 1) % 1;
  // light 0..1 (0.5 = neutral) shifts every tone's HSL lightness up or down.
  const dl = (light - 0.5) * 0.7;
  const cl = (l: number): number => Math.max(0.03, Math.min(0.95, l + dl));
  return {
    chassis: new Color().setHSL(h, 0.5, cl(0.16)).getHex(),
    trim: new Color().setHSL(h, 0.45, cl(0.08)).getHex(),
    accent: new Color().setHSL(h, 0.9, cl(0.56)).getHex(),
  };
}

/** A skin recoloured to a custom hue + lightness — keeps the SHAPE
 *  (id/name/slim), repaints the whole armour. */
export function tintSkin(base: AvatarSkin, hue: number, light = 0.5): AvatarSkin {
  return { ...base, ...colorPalette(hue, light) };
}

/** The skin to actually wear: the chosen shape, recoloured to `hue` when one is
 *  set (hue < 0 keeps the shape's own default palette). */
export function resolveAvatarSkin(id: string, hue: number, light = 0.5): AvatarSkin {
  const base = avatarSkin(id);
  return hue >= 0 && !base.locked ? tintSkin(base, hue, light) : base;
}

const _white = new Color(0xffffff);

/**
 * Recolour an avatar (rig piece, whole torso, glove, the mirror…) to a skin.
 * Glove LEDs (materials carrying `litIntensity`) keep their TEAM colour —
 * the squeeze tell must stay readable whatever the fashion.
 */
export function applyAvatarSkin(root: Object3D, skin: AvatarSkin): void {
  if (skin.locked) return;
  root.traverse((o) => {
    // Per-skin ornament geometry (antennas, horns, plumes, winglets…):
    // each piece carries the id of the ONE skin it belongs to.
    if (o.userData?.skinTag) o.visible = o.userData.skinTag === skin.id;
    const m = (o as Mesh).material as MeshStandardMaterial | undefined;
    if (!m || Array.isArray(m) || !m.userData?.role) return;
    switch (m.userData.role) {
      case 'chassis':
        m.color.setHex(skin.chassis);
        if (m.emissiveIntensity > 0 && m.userData.litIntensity === undefined) {
          m.emissive.setHex(skin.accent);
        }
        break;
      case 'trim':
        m.color.setHex(skin.trim);
        break;
      case 'hand':
        // The hands tint to the skin's steel but stay near-black at rest;
        // the white active bloom is owned by setGloveLit.
        m.color.setHex(skin.chassis);
        break;
      case 'glow':
        if (m.userData.litIntensity !== undefined) break; // team LED — leave it
        m.color.setHex(skin.accent);
        m.emissive.setHex(skin.accent);
        break;
    }
  });
  // Silhouette: PANTHER runs a slimmer chest/pelvis. Group scale only.
  const chest = root.getObjectByName('opponent-chest');
  const pelvis = root.getObjectByName('opponent-pelvis');
  if (chest) chest.scale.set(skin.slim ? 0.82 : 1, 1, skin.slim ? 0.88 : 1);
  if (pelvis) pelvis.scale.set(skin.slim ? 0.86 : 1, 1, skin.slim ? 0.9 : 1);
}

/** Recolour a platform group's neon piping + slab tint to a skin. */
export function applyPlatformSkin(root: Object3D, skin: PlatformSkin): void {
  if (skin.locked) return;
  root.traverse((o) => {
    if (o.userData?.skinTag) o.visible = o.userData.skinTag === skin.id;
    const m = (o as Mesh).material as MeshStandardMaterial | undefined;
    if (!m || Array.isArray(m) || !m.userData?.role) return;
    switch (m.userData.role) {
      case 'slab':
        // Deck glows faintly in the neon by default; slabEmissive overrides
        // it (VOLT wants a black deck under its yellow rim, not olive).
        m.emissive.setHex(skin.slabEmissive ?? skin.neon);
        m.emissiveIntensity = skin.slabGlow ?? 0.08;
        // Premium pads repaint the steel; plain recolours restore the default.
        m.color.setHex(skin.slab ?? DEFAULT_SLAB_TINT);
        m.roughness = skin.slabRough ?? DEFAULT_SLAB_ROUGH;
        m.metalness = skin.slabMetal ?? DEFAULT_SLAB_METAL;
        break;
      case 'neon-core':
        m.color.copy(new Color(skin.neon).lerp(_white, 0.45));
        break;
      case 'neon-halo':
        m.color.setHex(skin.neon);
        break;
    }
  });
}
