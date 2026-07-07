/**
 * The iron boxer — the opponent's avatar, styled like a 90s UK robot-wars
 * machine: an eight-sided helmet with a glowing visor slit, a shoulder-heavy
 * torso (wide armoured yoke + sloped pauldrons tapering down to a narrow
 * waist — the silhouette is THICKEST at the shoulders), a small pelvis block,
 * and two chunky mechanical gauntlets driven straight by the (bot or remote)
 * hand poses. No legs — floating hands and iron, on brand.
 *
 * The body volumes still track the gameplay hitboxes (head/chest/pelvis
 * spheres from BODY_IK) so what you see is what you can hit.
 */

import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  RepeatWrapping,
  SphereGeometry,
  Vector3,
} from 'three';
import { BODY_IK, PALETTE, teamColor } from '../config.js';
import { buildHand } from './hands.js';

/**
 * A shared brushed-steel roughness map: fine horizontal grain + speckle so the
 * armour plate reads as worked metal under the room reflections, not a flat
 * panel. One texture, tiled across every chassis/trim material.
 */
function brushedSteelMap(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#8a8a8a';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    const len = 4 + Math.random() * 22;
    const g = (110 + Math.random() * 110) | 0;
    ctx.strokeStyle = `rgba(${g},${g},${g},0.5)`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y); // horizontal brush strokes
    ctx.stroke();
  }
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

const STEEL_ROUGH = brushedSteelMap();

export interface BoxerRig {
  /** Helmet + visor; position/orient from the head pose. */
  head: Group;
  /** Container for the solved torso pieces (sits at the world origin). */
  torso: Group;
  /** Shoulder yoke + pauldrons + trunk; placed/oriented at the chest point. */
  chest: Group;
  /** Pelvis block; placed at the hips. */
  pelvis: Group;
  /** One gauntlet per hand; position/orient from the hand poses. */
  gloves: [Group, Group];
  /** Everything, for showing/hiding as one. */
  all: Group[];
}

export const GLOVE_VISUAL_SCALE = 1.28;

function chassisMat(emissive = 0, intensity = 0): MeshStandardMaterial {
  // Near-black mirror steel: the RoomEnvironment reflections do the reading.
  const m = new MeshStandardMaterial({
    color: 0x1c1f25,
    emissive,
    emissiveIntensity: intensity,
    metalness: 0.96,
    roughness: 0.2,
  });
  if (STEEL_ROUGH) m.roughnessMap = STEEL_ROUGH; // brushed-metal grain
  m.userData.role = 'chassis'; // skin recolour target (avatar/skins.ts)
  // Steel body tinted by the accent through its emissive channel only.
  if (emissive) m.userData.accent = 'emissive';
  return m;
}

function darkMat(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: 0x121419,
    metalness: 0.9,
    roughness: 0.3,
  });
  if (STEEL_ROUGH) m.roughnessMap = STEEL_ROUGH;
  m.userData.role = 'trim';
  return m;
}

function glowMat(color: number, intensity = 1.4): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    metalness: 0.2,
    roughness: 0.3,
  });
  m.userData.role = 'glow';
  // A pure neon highlight: both its base colour and glow follow the accent.
  m.userData.accent = 'glow';
  return m;
}

/** A thin neon band WRAPPED around a lofted body at height `y` — unlike a
 *  surface filament it encircles the volume, so it can never read as
 *  floating. `halfW`/`halfD` hug the loft's cross-section there (plus a
 *  little proud), `zC` recentres on sections that sit off-axis. */
function glowBand(accent: number, y: number, halfW: number, halfD: number, zC = 0, h = 0.016, intensity = 0.9): Mesh {
  const band = new Mesh(new CylinderGeometry(1, 1, h, 24, 1, true), glowMat(accent, intensity));
  band.scale.set(halfW, 1, halfD);
  band.position.set(0, y, zC);
  return band;
}

/**
 * How much of the accent the STEEL BODY takes through its emissive channel.
 * The glowing neon parts wear the colour at full; the chassis takes a softened
 * share of it — enough to keep that neon-lit sheen washing over the suit, but
 * short of the full hue (which used to paint the body a slab of the accent).
 */
const BODY_ACCENT_TINT = 0.5;

/**
 * Re-tint every accent-tagged material under a built avatar (glove or boxer)
 * to `color`. Glow highlights take it on both colour + emissive; chassis steel
 * only on a heavily DAMPENED emissive tint, so the body stays forged metal
 * rather than a slab of the accent. Cheap enough to call live while dragging a
 * slider.
 */
export function setAvatarAccent(root: Object3D, color: number): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const mode = (mat as MeshStandardMaterial).userData?.accent;
      const m = mat as MeshStandardMaterial;
      if (mode === 'glow') {
        m.color.set(color);
        m.emissive.set(color);
      } else if (mode === 'emissive') {
        // `set` resets from the hue, then the scale dims it — idempotent across
        // repeated slider drags, so the body never builds up colour.
        m.emissive.set(color).multiplyScalar(BODY_ACCENT_TINT);
      }
    }
  });
}

/**
 * A chunky mechanical gauntlet: armoured fist block, riveted knuckle plate
 * with glowing studs, side armour, a top piston, and a flared cuff with a
 * team-glow ring. Knuckles point down local -Z.
 *
 * The glow parts double as LEDs: they're registered on `glove.userData.leds`
 * and `setGloveLit` flares them while the owner squeezes trigger/grip — a
 * readable tell on BOTH boxers' fists.
 */
export function buildGlove(team: number, accent: number = teamColor(team)): Group {
  const glove = new Group();
  glove.scale.setScalar(GLOVE_VISUAL_SCALE);

  const leds: MeshStandardMaterial[] = [];
  /** Register a material as an LED: `lit` flares it to litIntensity. */
  const registerLed = (
    m: MeshStandardMaterial,
    base: number,
    litIntensity: number,
    whiten: number,
  ): MeshStandardMaterial => {
    m.userData.baseIntensity = base;
    m.userData.litIntensity = litIntensity;
    m.userData.baseColor = new Color(accent);
    m.userData.litColor = new Color(accent).lerp(new Color(PALETTE.white), whiten);
    leds.push(m);
    return m;
  };
  const ledMat = (base: number, litIntensity: number): MeshStandardMaterial =>
    registerLed(glowMat(accent, base), base, litIntensity, 0.7);
  glove.userData.leds = leds;

  // The fist: one thick armoured block — its faint team glow joins the LED
  // set so the WHOLE fist visibly charges up, readable across the arena.
  const fist = new Mesh(
    new BoxGeometry(0.16, 0.125, 0.17),
    registerLed(chassisMat(accent, 0.06), 0.06, 1.1, 0.35),
  );
  fist.position.z = -0.015;
  glove.add(fist);

  // Knuckle plate riding the top front edge.
  const plate = new Mesh(new BoxGeometry(0.165, 0.05, 0.07), darkMat());
  plate.position.set(0, 0.05, -0.075);
  glove.add(plate);

  // Four glowing knuckle studs across the strike face.
  for (let i = 0; i < 4; i++) {
    const stud = new Mesh(new BoxGeometry(0.024, 0.022, 0.02), ledMat(1.1, 5.0));
    stud.position.set(-0.054 + i * 0.036, 0.052, -0.108);
    glove.add(stud);
  }

  // Side armour cheeks.
  for (const side of [-1, 1]) {
    const cheek = new Mesh(new BoxGeometry(0.022, 0.1, 0.13), darkMat());
    cheek.position.set(side * 0.09, 0, -0.01);
    glove.add(cheek);
  }

  // Recoil piston along the top.
  const piston = new Mesh(new CylinderGeometry(0.016, 0.016, 0.1, 8), darkMat());
  piston.rotation.x = Math.PI / 2;
  piston.position.set(0, 0.07, 0.02);
  glove.add(piston);
  const rod = new Mesh(new CylinderGeometry(0.008, 0.008, 0.06, 8), ledMat(0.7, 3.5));
  rod.rotation.x = Math.PI / 2;
  rod.position.set(0, 0.07, -0.05);
  glove.add(rod);

  // Flared cuff with a glowing team ring.
  const cuff = new Mesh(new CylinderGeometry(0.06, 0.078, 0.08, 8), chassisMat());
  cuff.rotation.x = Math.PI / 2;
  cuff.position.z = 0.095;
  glove.add(cuff);
  const ring = new Mesh(new CylinderGeometry(0.073, 0.073, 0.018, 8), ledMat(0.9, 4.0));
  ring.rotation.x = Math.PI / 2;
  ring.position.z = 0.07;
  glove.add(ring);

  return glove;
}

/**
 * Flare (or settle) a gauntlet's LEDs. `lit` = the hand is ACTIVE — its
 * owner is squeezing trigger/grip, or its ball is mid-return. Eases so the
 * light blooms on and fades off.
 */
export function setGloveLit(glove: Group, lit: boolean, delta: number): void {
  const leds = glove.userData.leds as MeshStandardMaterial[] | undefined;
  if (!leds) return;
  const k = Math.min(1, delta * 14);
  for (const m of leds) {
    const target = lit
      ? ((m.userData.litIntensity as number) ?? 3)
      : ((m.userData.baseIntensity as number) ?? 1);
    m.emissiveIntensity += (target - m.emissiveIntensity) * k;
    m.emissive.lerp(lit ? (m.userData.litColor as Color) : (m.userData.baseColor as Color), k);
  }
}

// ---------------------------------------------------------------------------
// Animal heads — a detailed metallic head per skin. Each is a self-contained
// Group tagged with the skin id it belongs to (applyAvatarSkin shows one). The
// front faces −z; everything is sized off BODY_IK.headRadius so the head fills
// the (unchanged) head hitbox sphere. Materials are role-tagged so a skin
// recolours them: chassis = body steel, trim = dark, glow = the accent (eyes).
// ---------------------------------------------------------------------------

function taggedHead(id: string): Group {
  const g = new Group();
  g.userData.skinTag = id;
  g.visible = false;
  return g;
}

/** COBALT → BEAR, lofted for accuracy: a broad domed skull that is widest
 *  at the cheeks, a dished STOP at the brow dropping onto a short deep
 *  muzzle, small close forward eyes, wide-set round cupped ears, a big nose
 *  pad and fur ruffs flaring off the jaw. */
function buildBearHead(accent: number): Group {
  const r = BODY_IK.headRadius;
  const g = taggedHead('cobalt');
  g.scale.setScalar(1.5); // a bear's head IS the intimidation — reads huge
  g.position.y = 0.05; // carried a touch high so the neck shows under the jaw

  // The skull loft, back of head → nose. A bear's profile is the opposite of
  // the horse's wedge: high round dome, a concave dip at the brow (the stop),
  // then a short, deep, nearly level muzzle ending in the nose pad.
  const skull = new Mesh(
    loftGeometry(
      [
        { top: [0.55, 0.55], bot: [-0.3, 0.6], w: 0.4, n: 2.0 }, // occiput
        { top: [0.86, 0.3], bot: [-0.48, 0.42], w: 0.55, n: 2.1 }, // crown
        { top: [0.84, 0.02], bot: [-0.55, 0.22], w: 0.62, n: 2.15 }, // cheeks (widest)
        { top: [0.6, -0.32], bot: [-0.55, -0.1], w: 0.58, n: 2.15 }, // brow
        { top: [0.22, -0.58], bot: [-0.52, -0.38], w: 0.42, n: 2.0 }, // the dished stop
        { top: [0.1, -0.76], bot: [-0.5, -0.6], w: 0.3, n: 1.95 }, // muzzle root
        { top: [0.04, -0.94], bot: [-0.46, -0.84], w: 0.27, n: 1.9 }, // mid muzzle
        { top: [0.02, -1.1], bot: [-0.38, -1.02], w: 0.22, n: 1.85 }, // nose
        { top: [0.0, -1.16], bot: [-0.3, -1.1], w: 0.13, n: 1.8 }, // tip
      ],
      r,
    ),
    chassisMat(accent, 0.06),
  );
  g.add(skull);

  // Round cupped ears set WIDE on the dome's top corners, dark inners
  // turned forward — the bear's unmistakable outline.
  for (const side of [-1, 1]) {
    const ear = new Mesh(new SphereGeometry(r * 0.27, 14, 12), chassisMat(accent, 0.05));
    ear.scale.set(1, 1, 0.55);
    ear.position.set(side * r * 0.5, r * 0.88, r * 0.12);
    ear.rotation.set(-0.15, side * 0.35, side * -0.12);
    g.add(ear);
    const inner = new Mesh(new SphereGeometry(r * 0.17, 12, 10), darkMat());
    inner.scale.set(1, 1, 0.4);
    inner.position.set(side * r * 0.52, r * 0.86, r * 0.05);
    inner.rotation.set(-0.15, side * 0.35, side * -0.12);
    g.add(inner);
  }

  // Small, close-set forward eyes — bear eyes are tiny relative to the huge
  // skull, which is what sells the scale. The lofted brow shades them.
  for (const side of [-1, 1]) {
    const socket = new Mesh(new SphereGeometry(r * 0.1, 12, 10), darkMat());
    socket.scale.set(0.85, 1, 0.7);
    socket.position.set(side * r * 0.27, r * 0.2, -r * 0.63);
    g.add(socket);
    const eye = new Mesh(new SphereGeometry(r * 0.075, 12, 10), glowMat(accent, 2.4));
    eye.scale.set(0.85, 1, 0.75);
    eye.position.set(side * r * 0.27, r * 0.195, -r * 0.67);
    eye.rotation.y = side * -0.2;
    g.add(eye);
  }

  // The big nose pad capping the muzzle, with the philtrum seam splitting
  // down to the mouth line and a soft chin below it.
  const nose = new Mesh(new SphereGeometry(r * 0.15, 12, 10), darkMat());
  nose.scale.set(1.25, 0.75, 0.7);
  nose.position.set(0, -r * 0.04, -r * 1.16);
  g.add(nose);
  const philtrum = new Mesh(new BoxGeometry(r * 0.035, r * 0.18, r * 0.03), darkMat());
  philtrum.position.set(0, -r * 0.22, -r * 1.14);
  philtrum.rotation.x = 0.25;
  g.add(philtrum);
  const mouth = new Mesh(new BoxGeometry(r * 0.28, r * 0.03, r * 0.3), darkMat());
  mouth.position.set(0, -r * 0.45, -r * 0.96);
  mouth.rotation.x = 0.15;
  g.add(mouth);
  const chin = new Mesh(new SphereGeometry(r * 0.13, 12, 10), chassisMat(accent, 0.05));
  chin.scale.set(1, 0.7, 0.85);
  chin.position.set(0, -r * 0.42, -r * 1.0);
  g.add(chin);

  // Fur ruffs: thin plates swept BACK along the cheeks and jaw — the shaggy
  // silhouette a real bear carries around its huge masseters, hugging the
  // skull rather than boarding off it.
  for (const side of [-1, 1]) {
    const upper = new Mesh(new BoxGeometry(r * 0.05, r * 0.36, r * 0.42), darkMat());
    upper.position.set(side * r * 0.55, -r * 0.2, r * 0.06);
    upper.rotation.set(0.15, side * 0.65, side * 0.3);
    g.add(upper);
    const lower = new Mesh(new BoxGeometry(r * 0.045, r * 0.28, r * 0.34), darkMat());
    lower.position.set(side * r * 0.45, -r * 0.38, -r * 0.1);
    lower.rotation.set(0.15, side * 0.6, side * 0.5);
    g.add(lower);
  }
  return g;
}

/** CRIMSON → PANTHER, lofted for accuracy — the default bot face, so this is
 *  the head players see most. A big cat's skull: nearly as wide as it is
 *  long, widest at the cheeks, a flat brow stepping down HARD onto a very
 *  short muzzle (a fifth of the head) built from puffy whisker pads around a
 *  high nose pad, a small chin, LARGE slanted forward-facing eyes, and big
 *  triangular ears on the top corners. Glowing whisker spines keep the neon. */
function buildPantherHead(accent: number): Group {
  const r = BODY_IK.headRadius;
  const g = taggedHead('crimson');
  g.scale.setScalar(1.35); // between the eagle and the bear
  g.position.y = 0.04; // carried a touch high so the neck shows under the jaw

  // The skull loft, occiput → nose. A cat is all cheeks and no snout: the
  // width peaks at the temples and holds through the eye line, then the
  // muzzle-stop station steps the section down to the tiny blunt muzzle.
  const skull = new Mesh(
    loftGeometry(
      [
        { top: [0.5, 0.48], bot: [-0.3, 0.52], w: 0.36, n: 2.0 }, // occiput
        { top: [0.72, 0.24], bot: [-0.46, 0.36], w: 0.5, n: 2.1 }, // crown
        { top: [0.74, -0.02], bot: [-0.5, 0.14], w: 0.56, n: 2.15 }, // temples (widest)
        { top: [0.58, -0.32], bot: [-0.52, -0.1], w: 0.53, n: 2.15 }, // brow
        { top: [0.26, -0.5], bot: [-0.5, -0.32], w: 0.43, n: 2.1 }, // eye plane — face turns STEEP
        { top: [0.0, -0.58], bot: [-0.48, -0.46], w: 0.24, n: 2.0 }, // the stop, nearly vertical
        { top: [-0.03, -0.74], bot: [-0.42, -0.62], w: 0.2, n: 1.9 }, // the short muzzle juts clear
        { top: [-0.03, -0.86], bot: [-0.36, -0.8], w: 0.14, n: 1.85 }, // nose
        { top: [-0.07, -0.92], bot: [-0.3, -0.86], w: 0.08, n: 1.8 }, // tip
      ],
      r,
    ),
    chassisMat(accent, 0.06),
  );
  g.add(skull);

  // The muzzle: two puffy whisker-pad ellipsoids side by side, the high-set
  // dark nose pad above them, the philtrum seam splitting down between, and
  // a small round chin tucked underneath — the whole cat mouth cluster.
  for (const side of [-1, 1]) {
    const pad = new Mesh(new SphereGeometry(r * 0.13, 14, 12), chassisMat(accent, 0.05));
    pad.scale.set(1.05, 0.82, 0.75);
    pad.position.set(side * r * 0.115, -r * 0.18, -r * 0.86);
    pad.rotation.y = side * -0.25;
    g.add(pad);
  }
  const nose = new Mesh(new SphereGeometry(r * 0.075, 10, 8), darkMat());
  nose.scale.set(1.1, 0.75, 0.6);
  nose.position.set(0, -r * 0.05, -r * 0.94);
  nose.rotation.x = 0.35;
  g.add(nose);
  const philtrum = new Mesh(new BoxGeometry(r * 0.03, r * 0.16, r * 0.03), darkMat());
  philtrum.position.set(0, -r * 0.2, -r * 0.93);
  philtrum.rotation.x = 0.2;
  g.add(philtrum);
  const mouth = new Mesh(new BoxGeometry(r * 0.14, r * 0.022, r * 0.12), darkMat());
  mouth.position.set(0, -r * 0.37, -r * 0.85);
  mouth.rotation.x = 0.75;
  g.add(mouth);
  const chin = new Mesh(new SphereGeometry(r * 0.1, 10, 8), chassisMat(accent, 0.05));
  chin.scale.set(0.9, 0.62, 0.8);
  chin.position.set(0, -r * 0.4, -r * 0.82);
  g.add(chin);

  // The eyes: LARGE, forward-facing and slanted — inner corners low, outer
  // corners swept up toward the ears. Cat stare first, everything else
  // second. Dark socket liner behind each so the almond reads.
  for (const side of [-1, 1]) {
    const socket = new Mesh(new SphereGeometry(r * 0.15, 14, 12), darkMat());
    socket.scale.set(0.85, 0.95, 0.55);
    socket.position.set(side * r * 0.25, r * 0.16, -r * 0.53);
    socket.rotation.set(0.15, side * -0.25, side * 0.18);
    g.add(socket);
    const eye = new Mesh(new SphereGeometry(r * 0.125, 14, 12), glowMat(accent, 3.0));
    eye.scale.set(0.8, 0.95, 0.55);
    eye.position.set(side * r * 0.26, r * 0.16, -r * 0.56);
    eye.rotation.set(0.15, side * -0.25, side * 0.18);
    g.add(eye);
  }

  // Big triangular ears riding the top corners, tips leaning out, deep dark
  // inners facing forward — with the short face, the cat silhouette.
  for (const side of [-1, 1]) {
    // A muff at the ear root bridges cone to dome, so the base can never
    // read as hovering off the skull's curve.
    const muff = new Mesh(new SphereGeometry(r * 0.14, 12, 10), chassisMat(accent, 0.05));
    muff.scale.set(1.0, 0.6, 0.85);
    muff.position.set(side * r * 0.33, r * 0.56, r * 0.06);
    muff.rotation.z = side * -0.3;
    g.add(muff);
    const ear = new Mesh(new ConeGeometry(r * 0.24, r * 0.42, 10), chassisMat(accent, 0.05));
    ear.scale.z = 0.6;
    ear.position.set(side * r * 0.34, r * 0.68, r * 0.07);
    ear.rotation.set(-0.1, 0, side * -0.18);
    g.add(ear);
    const inner = new Mesh(new ConeGeometry(r * 0.15, r * 0.32, 10), darkMat());
    inner.scale.z = 0.5;
    inner.position.set(side * r * 0.35, r * 0.655, r * 0.02);
    inner.rotation.set(-0.1, 0, side * -0.18);
    g.add(inner);
  }

  // Glowing metal whisker spines — the panther's accent signature. Each one
  // ROOTS on the whisker pad and is aimed by real whisker geometry: fanned
  // down the pad in rows, swept back along the cheek, the top row carried
  // slightly proud and the lower rows drooping — mirrored properly per side
  // (the old ones pivoted from mid-cheek and swept backward on one side of
  // the face but forward on the other).
  const _wDir = new Vector3();
  const _yUp = new Vector3(0, 1, 0);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const droop = 0.16 - i * 0.17; // raised top whisker → drooping lower ones
      const sweep = 0.38 + (i % 2) * 0.22; // alternate columns sweep further back
      const len = r * (0.8 - i * 0.05);
      _wDir
        .set(side * Math.cos(droop) * Math.cos(sweep), Math.sin(droop), Math.cos(droop) * Math.sin(sweep))
        .normalize();
      const wsp = new Mesh(new CylinderGeometry(r * 0.01, r * 0.003, len, 4), glowMat(accent, 0.45));
      wsp.quaternion.setFromUnitVectors(_yUp, _wDir);
      wsp.position
        .set(side * r * 0.13, -r * (0.08 + i * 0.055), -r * 0.9)
        .addScaledVector(_wDir, len / 2);
      g.add(wsp);
    }
  }
  return g;
}

/** VALKYRIE → EAGLE, lofted for accuracy: a sleek rounded raptor skull with
 *  a heavy supraorbital ledge shading fierce side-set eyes, the huge hooked
 *  beak lofted through its real down-curve (cere, nostrils, and a smaller
 *  lower mandible tucked beneath), and a hackle ruff of layered feathers
 *  around the nape instead of a fantasy mohawk. */
function buildEagleHead(accent: number): Group {
  const r = BODY_IK.headRadius;
  const g = taggedHead('valkyrie');
  g.scale.setScalar(1.5); // carried proud — as big as the bear
  g.position.y = 0.09; // highest carry of the three — the low nape ruff needs the clearance

  // The head loft, nape → cere. The crown stays high and flat all the way
  // to the brow ledge (the eagle "scowl" is bone, not eyebrow), then steps
  // down sharply onto the beak base.
  const skull = new Mesh(
    loftGeometry(
      [
        { top: [0.48, 0.5], bot: [-0.42, 0.58], w: 0.4, n: 2.05 }, // nape ruff root
        { top: [0.64, 0.28], bot: [-0.48, 0.42], w: 0.45, n: 2.05 }, // back crown
        { top: [0.68, -0.05], bot: [-0.5, 0.18], w: 0.46, n: 2.1 }, // crown (low, flat)
        { top: [0.7, -0.45], bot: [-0.46, -0.15], w: 0.44, n: 2.3 }, // brow shelf (proud, square)
        { top: [0.44, -0.66], bot: [-0.4, -0.46], w: 0.34, n: 2.1 }, // eye line, cut UNDER the shelf
        { top: [0.28, -0.88], bot: [-0.32, -0.7], w: 0.24, n: 2.0 }, // forehead step
        { top: [0.2, -1.0], bot: [-0.26, -0.84], w: 0.17, n: 1.9 }, // cere
      ],
      r,
    ),
    chassisMat(accent, 0.06),
  );
  g.add(skull);

  // The upper beak: one loft riding the real raptor curve — it projects
  // FORWARD from the cere, the culmen staying nearly level, then
  // accelerates DOWN into the hooked tip that ends below the mouth line.
  const beak = new Mesh(
    loftGeometry(
      [
        { top: [0.22, -0.92], bot: [-0.34, -0.8], w: 0.18, n: 1.9 }, // buried in the head
        { top: [0.1, -1.18], bot: [-0.38, -1.06], w: 0.145, n: 1.85 },
        { top: [-0.06, -1.38], bot: [-0.4, -1.24], w: 0.11, n: 1.8 },
        { top: [-0.24, -1.5], bot: [-0.42, -1.38], w: 0.065, n: 1.75 },
        { top: [-0.46, -1.5], bot: [-0.5, -1.42], w: 0.025, n: 1.7 }, // the hook, dropping dead-down
      ],
      r,
    ),
    chassisMat(accent, 0.09),
  );
  g.add(beak);

  // The smaller lower mandible tucked under the upper beak's cutting edge.
  const mandible = new Mesh(
    loftGeometry(
      [
        { top: [-0.32, -0.82], bot: [-0.5, -0.76], w: 0.135, n: 1.9 },
        { top: [-0.36, -1.04], bot: [-0.52, -0.98], w: 0.1, n: 1.85 },
        { top: [-0.42, -1.26], bot: [-0.5, -1.22], w: 0.05, n: 1.8 },
      ],
      r,
    ),
    darkMat(),
  );
  g.add(mandible);

  // Cere saddle wrapping the beak root, hiding the head/beak seam, with the
  // two nostril slits ahead of it.
  const cere = new Mesh(new SphereGeometry(r * 0.13, 12, 10), darkMat());
  cere.scale.set(1.15, 0.6, 0.9);
  cere.position.set(0, r * 0.14, -r * 0.9);
  cere.rotation.x = 0.5;
  g.add(cere);
  for (const side of [-1, 1]) {
    const nostril = new Mesh(new SphereGeometry(r * 0.035, 8, 6), darkMat());
    nostril.scale.set(0.7, 1, 0.6);
    nostril.position.set(side * r * 0.09, r * 0.06, -r * 1.04);
    g.add(nostril);
  }

  // The eyes tuck up under the lofted brow shelf's crease — the eye in
  // shadow BENEATH the bony overhang is the whole raptor glare.
  for (const side of [-1, 1]) {
    const socket = new Mesh(new SphereGeometry(r * 0.12, 12, 10), darkMat());
    socket.scale.set(0.7, 0.9, 0.9);
    socket.position.set(side * r * 0.31, r * 0.4, -r * 0.54);
    g.add(socket);
    const eye = new Mesh(new SphereGeometry(r * 0.095, 12, 10), glowMat(accent, 2.8));
    eye.scale.set(0.75, 1, 0.9);
    eye.position.set(side * r * 0.34, r * 0.39, -r * 0.56);
    eye.rotation.y = side * -0.5;
    g.add(eye);
  }

  // The hackle ruff: a second, smaller loft flaring back and DOWN off the
  // nape — the layered feather collar a real eagle carries, read as one
  // smooth swept mass instead of taped-on plates.
  const ruff = new Mesh(
    loftGeometry(
      [
        { top: [0.52, 0.3], bot: [-0.46, 0.4], w: 0.42, n: 2.1 }, // buried in the head
        { top: [0.28, 0.6], bot: [-0.6, 0.66], w: 0.47, n: 2.0 }, // flaring…
        { top: [-0.08, 0.76], bot: [-0.68, 0.78], w: 0.38, n: 1.9 }, // …to the collar tip
      ],
      r,
    ),
    chassisMat(accent, 0.05),
  );
  g.add(ruff);

  // The CREST: a fan of long feathers sweeping up and back off the crown —
  // harpy-eagle style — tallest over the poll, laying flatter as it runs
  // down the nape. Each dark feather carries a thin accent vane, so this is
  // also where the head reads team-coloured across the arena.
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const len = r * (0.62 + Math.sin(t * Math.PI) * 0.3);
    const tilt = -0.12 + t * 1.02; // near-vertical in front → swept back at the nape
    const baseY = r * (0.6 - t * 0.16);
    const baseZ = r * (-0.12 + t * 0.56);
    const cy = baseY + (Math.cos(tilt) * len) / 2 - r * 0.08;
    const cz = baseZ + (Math.sin(tilt) * len) / 2;
    const feather = new Mesh(new BoxGeometry(r * 0.13, len, r * 0.16), darkMat());
    feather.position.set(0, cy, cz);
    feather.rotation.x = tilt;
    g.add(feather);
    const vane = new Mesh(new BoxGeometry(r * 0.045, len * 0.9, r * 0.17), glowMat(accent, 0.6 + Math.sin(t * Math.PI) * 0.25));
    vane.position.set(0, cy + r * 0.015, cz);
    vane.rotation.x = tilt;
    g.add(vane);
  }
  // A shorter flanking pair splayed off the crown for crest volume.
  for (const side of [-1, 1]) {
    const feather = new Mesh(new BoxGeometry(r * 0.1, r * 0.52, r * 0.13), darkMat());
    feather.position.set(side * r * 0.16, r * 0.84, r * 0.1);
    feather.rotation.set(0.18, 0, side * -0.22);
    g.add(feather);
  }

  // Cheek feather lines sweeping back from the beak under the eyes.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const plate = new Mesh(new BoxGeometry(r * 0.06, r * 0.3, r * 0.42 - i * r * 0.1), chassisMat(accent, 0.04));
      plate.position.set(side * (r * 0.42 - i * r * 0.06), -r * 0.1 - i * r * 0.14, -r * 0.35 + i * r * 0.12);
      plate.rotation.set(0, side * 0.5, side * 0.28);
      g.add(plate);
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// Torso armour — a distinct cuirass + hip set per skin, each tagged so
// applyAvatarSkin shows ONE. Same silhouette envelope (wide shoulders → taper)
// and the same BODY_IK hitbox spheres, so they stay equally hittable.
// ---------------------------------------------------------------------------

/** COBALT → BEAR: one hulking lofted barrel to match the lofted head — a
 *  shoulder hump behind the neck, boulder pauldrons, round pecs, shaggy dark
 *  fur plates on the flanks, and a triple claw-mark scar glowing across the
 *  left pec. Wide shoulders, hard waist taper — brutish but organic. */
function buildBearChest(accent: number): Group {
  const g = taggedHead('cobalt');
  // A REAL neck: tall dark column rising well clear of the yoke to meet the
  // head, so the skull doesn't sit swallowed in the shoulders.
  const neck = new Mesh(new CylinderGeometry(0.075, 0.105, 0.22, 10), darkMat());
  neck.position.y = 0.25;
  g.add(neck);

  // The torso core: a vertical loft, shoulders → waist. The first ring tilts
  // back-up into the shoulder HUMP; the barrel is deepest at the pecs and
  // pinches hard to the waist.
  const core = new Mesh(
    loftGeometry(
      [
        { top: [0.24, -0.06], bot: [0.27, 0.14], w: 0.13, n: 2.0 }, // neck ring → hump
        { top: [0.16, -0.17], bot: [0.18, 0.19], w: 0.3, n: 2.1 }, // shoulder line
        { top: [0.04, -0.21], bot: [0.05, 0.19], w: 0.27, n: 2.1 }, // the barrel (deepest)
        { top: [-0.12, -0.17], bot: [-0.12, 0.15], w: 0.2, n: 2.05 }, // ribs
        { top: [-0.28, -0.1], bot: [-0.28, 0.1], w: 0.12, n: 2.0 }, // waist
        { top: [-0.31, -0.095], bot: [-0.31, 0.095], w: 0.115, n: 2.0 }, // hem — flat cut below the band
      ],
      1,
    ),
    chassisMat(accent, 0.05),
  );
  g.add(core);

  // The hump proper stays organic muscle behind the neck.
  const hump = new Mesh(new SphereGeometry(0.1, 16, 12), chassisMat(accent, 0.05));
  hump.scale.set(1.25, 0.6, 0.9);
  hump.position.set(0, 0.2, 0.08);
  g.add(hump);

  // Bespoke PAULDRONS: a domed crown shell with two smaller shells
  // cascading tight beneath it, wrapping the shoulder's curve — heavy
  // lapped bear armour, each plate mostly tucked under the one above.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const plate = new Mesh(new SphereGeometry(0.105 - i * 0.02, 16, 12), chassisMat(accent, 0.05));
      plate.scale.set(1.1, 0.55 - i * 0.06, 1.0);
      plate.position.set(side * (0.28 + i * 0.012), 0.165 - i * 0.042, 0);
      plate.rotation.z = side * -(0.15 + i * 0.22);
      g.add(plate);
    }
  }

  // A short fur fringe under the chest — the flanks stay clean.
  for (let i = -1; i <= 1; i++) {
    const fringe = new Mesh(new BoxGeometry(0.05, 0.1, 0.025), darkMat());
    fringe.position.set(i * 0.07, -0.12, -0.14);
    fringe.rotation.set(0.3, i * 0.25, i * 0.15);
    g.add(fringe);
  }

  // The scars: three claw-mark slashes glowing across the left of the chest,
  // and an older two-slash rake low on the right flank.
  for (let i = 0; i < 3; i++) {
    const claw = new Mesh(new BoxGeometry(0.016, 0.11, 0.012), glowMat(accent, 0.9));
    claw.position.set(-0.04 - i * 0.042, 0.04 - i * 0.012, -0.202 + i * 0.006);
    claw.rotation.set(0.12, 0, -0.35);
    g.add(claw);
  }
  for (let i = 0; i < 2; i++) {
    const claw = new Mesh(new BoxGeometry(0.013, 0.08, 0.011), glowMat(accent, 0.7));
    claw.position.set(0.12 + i * 0.036, -0.15 - i * 0.01, -0.145 + i * 0.008);
    claw.rotation.set(0.1, 0.25, 0.4);
    g.add(claw);
  }

  // Neon that wraps instead of floats: a collar band where the neck meets
  // the yoke, a waist band at the taper, and three ember studs glowing out
  // of each shoulder boulder like coals in the fur.
  g.add(glowBand(accent, 0.228, 0.172, 0.128, 0.042, 0.018, 0.85));
  g.add(glowBand(accent, -0.29, 0.122, 0.104, 0.0, 0.016, 0.85));
  for (const side of [-1, 1]) {
    for (let j = 0; j < 3; j++) {
      const ember = new Mesh(new SphereGeometry(0.009, 8, 6), glowMat(accent, 1.6));
      ember.position.set(side * (0.24 + j * 0.038), 0.203 - j * 0.02, -0.045 - j * 0.008);
      g.add(ember);
    }
  }
  return g;
}

/** CRIMSON → PANTHER (SHADOW): the classic sleek bladed cuirass — sharp
 *  angled plates, shoulder blades, V pecs, chevron abs. Predatory. Restored
 *  by request; only the head above it is the new lofted design, so the neck
 *  runs taller than the original to meet its raised carry. */
function buildPantherChest(accent: number): Group {
  const g = taggedHead('crimson');
  const collar = new Mesh(new BoxGeometry(0.4, 0.08, 0.19), chassisMat(accent, 0.05));
  collar.position.y = 0.11;
  g.add(collar);
  const neck = new Mesh(new CylinderGeometry(0.065, 0.085, 0.2, 8), darkMat());
  neck.position.y = 0.22;
  g.add(neck);
  for (const side of [-1, 1]) {
    const pad = new Mesh(new BoxGeometry(0.19, 0.07, 0.26), chassisMat(accent, 0.05));
    pad.position.set(side * 0.27, 0.12, 0);
    pad.rotation.z = side * -0.26;
    g.add(pad);
    const blade = new Mesh(new ConeGeometry(0.03, 0.2, 4), darkMat());
    blade.position.set(side * 0.34, 0.16, -0.04);
    blade.rotation.set(-0.5, 0, side * -0.5);
    g.add(blade);
    const lip = new Mesh(new BoxGeometry(0.195, 0.015, 0.265), glowMat(accent, 0.55));
    lip.position.set(side * 0.27, 0.165, 0);
    lip.rotation.z = side * -0.26;
    g.add(lip);
  }
  const trunk = new Mesh(new CylinderGeometry(0.155, 0.08, 0.42, 8), darkMat());
  trunk.scale.z = 0.72;
  trunk.position.y = -0.13;
  g.add(trunk);
  for (const side of [-1, 1]) {
    const pec = new Mesh(new BoxGeometry(0.14, 0.17, 0.06), chassisMat(accent, 0.05));
    pec.position.set(side * 0.08, 0.0, -0.13);
    pec.rotation.set(0.1, side * 0.4, side * 0.12);
    g.add(pec);
  }
  const core = new Mesh(new BoxGeometry(0.04, 0.16, 0.04), glowMat(accent, 1.4));
  core.position.set(0, -0.02, -0.16);
  g.add(core);
  for (let i = 0; i < 3; i++) {
    const w = 0.18 - i * 0.035;
    const ab = new Mesh(new BoxGeometry(w, 0.05, 0.07), chassisMat(accent, 0.04));
    ab.position.set(0, -0.15 - i * 0.072, -0.1);
    ab.rotation.x = -0.1;
    g.add(ab);
    const seam = new Mesh(new BoxGeometry(w * 0.9, 0.009, 0.072), glowMat(accent, 0.32));
    seam.position.set(0, -0.178 - i * 0.072, -0.1);
    g.add(seam);
  }
  for (const side of [-1, 1]) {
    const flank = new Mesh(new BoxGeometry(0.045, 0.26, 0.2), chassisMat(accent, 0.04));
    flank.position.set(side * 0.14, -0.08, 0);
    flank.rotation.z = side * 0.14;
    g.add(flank);
  }
  return g;
}

/** VALKYRIE → EAGLE: the classic regal winged cuirass — a crest emblem,
 *  glowing winglet pauldrons, layered feather breast plates, a chevron
 *  sigil. Restored by request; only the head above it is the new lofted
 *  raptor, so the neck runs taller than the original to meet its raised
 *  carry. */
function buildEagleChest(accent: number): Group {
  const g = taggedHead('valkyrie');
  const collar = new Mesh(new BoxGeometry(0.4, 0.08, 0.19), chassisMat(accent, 0.05));
  collar.position.y = 0.11;
  g.add(collar);
  const neck = new Mesh(new CylinderGeometry(0.06, 0.08, 0.26, 8), darkMat());
  neck.position.y = 0.27;
  g.add(neck);
  const crest = new Mesh(new BoxGeometry(0.05, 0.07, 0.04), glowMat(accent, 1.2));
  crest.position.set(0, 0.2, -0.06);
  crest.rotation.z = Math.PI / 4;
  g.add(crest);
  for (const side of [-1, 1]) {
    const base = new Mesh(new BoxGeometry(0.16, 0.07, 0.24), chassisMat(accent, 0.05));
    base.position.set(side * 0.26, 0.12, 0);
    base.rotation.z = side * -0.22;
    g.add(base);
    for (let i = 0; i < 3; i++) {
      const feather = new Mesh(new BoxGeometry(0.04, 0.14 - i * 0.02, 0.1), glowMat(accent, 0.5 + (2 - i) * 0.18));
      feather.position.set(side * (0.3 + i * 0.05), 0.16 + i * 0.02, 0.02 + i * 0.03);
      feather.rotation.set(0.2, side * 0.3, side * (0.5 + i * 0.1));
      g.add(feather);
    }
  }
  const trunk = new Mesh(new CylinderGeometry(0.155, 0.08, 0.42, 8), darkMat());
  trunk.scale.z = 0.72;
  trunk.position.y = -0.13;
  g.add(trunk);
  for (let i = 0; i < 3; i++) {
    const w = 0.26 - i * 0.05;
    const plate = new Mesh(new BoxGeometry(w, 0.09, 0.06), chassisMat(accent, 0.05));
    plate.position.set(0, 0.06 - i * 0.08, -0.12 - i * 0.005);
    plate.rotation.x = -0.18;
    g.add(plate);
  }
  const chevron = new Mesh(new BoxGeometry(0.16, 0.02, 0.05), glowMat(accent, 0.9));
  chevron.position.set(0, -0.03, -0.16);
  g.add(chevron);
  for (let i = 0; i < 3; i++) {
    const w = 0.16 - i * 0.03;
    const ab = new Mesh(new BoxGeometry(w, 0.045, 0.07), chassisMat(accent, 0.04));
    ab.position.set(0, -0.2 - i * 0.065, -0.1);
    g.add(ab);
  }
  for (const side of [-1, 1]) {
    const flank = new Mesh(new BoxGeometry(0.045, 0.24, 0.2), chassisMat(accent, 0.04));
    flank.position.set(side * 0.14, -0.08, 0);
    flank.rotation.z = side * 0.13;
    g.add(flank);
  }
  return g;
}

/** BEAR hips: NONE — the redesigned bodies are a clean V, the torso
 *  tapering to a point with nothing below (the pelvis hitbox sphere is
 *  unchanged; there's just no geometry drawn at it). */
function buildBearPelvis(_accent: number): Group {
  return taggedHead('cobalt');
}

/** PANTHER hips: slim belt, a pointed guard, bladed glow-edged tassets —
 *  the classic set, restored along with the old cuirass. */
function buildPantherPelvis(accent: number): Group {
  const g = taggedHead('crimson');
  const belt = new Mesh(new BoxGeometry(0.19, 0.05, 0.15), chassisMat(accent, 0.04));
  belt.position.y = 0.05;
  g.add(belt);
  const buckle = new Mesh(new BoxGeometry(0.045, 0.045, 0.03), glowMat(accent, 1.1));
  buckle.position.set(0, 0.05, -0.08);
  g.add(buckle);
  const guard = new Mesh(new ConeGeometry(0.08, 0.18, 5), chassisMat(accent, 0.03));
  guard.rotation.x = Math.PI;
  guard.position.set(0, -0.06, -0.03);
  g.add(guard);
  for (const side of [-1, 1]) {
    const tasset = new Mesh(new BoxGeometry(0.055, 0.18, 0.12), chassisMat(accent, 0.04));
    tasset.position.set(side * 0.1, -0.05, 0);
    tasset.rotation.z = side * 0.34;
    g.add(tasset);
    const edge = new Mesh(new BoxGeometry(0.06, 0.013, 0.125), glowMat(accent, 0.4));
    edge.position.set(side * 0.12, -0.13, 0);
    edge.rotation.z = side * 0.34;
    g.add(edge);
  }
  return g;
}

/** EAGLE hips: glow-trimmed belt, tapered guard, layered feathered tassets —
 *  the classic set, restored along with the old cuirass. */
function buildEaglePelvis(accent: number): Group {
  const g = taggedHead('valkyrie');
  const belt = new Mesh(new BoxGeometry(0.2, 0.05, 0.16), chassisMat(accent, 0.04));
  belt.position.y = 0.05;
  g.add(belt);
  const beltGlow = new Mesh(new BoxGeometry(0.205, 0.015, 0.165), glowMat(accent, 0.5));
  beltGlow.position.y = 0.075;
  g.add(beltGlow);
  const guard = new Mesh(new CylinderGeometry(0.08, 0.03, 0.14, 6), chassisMat(accent, 0.03));
  guard.position.set(0, -0.05, -0.02);
  g.add(guard);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const t = new Mesh(
        new BoxGeometry(0.05, 0.12 - i * 0.02, 0.11),
        i === 0 ? chassisMat(accent, 0.04) : glowMat(accent, 0.4),
      );
      // Stagger the layers in DEPTH (z), not just XY — otherwise the glow plate
      // and the chassis plate share a front plane where they overlap and the
      // neon z-fights/flickers. The glow edge now sits proud in front.
      t.position.set(side * (0.09 + i * 0.03), -0.04 - i * 0.04, -i * 0.022);
      t.rotation.z = side * (0.28 + i * 0.1);
      g.add(t);
    }
  }
  return g;
}

/** KNIGHT → a CRUSADER great helm: a flat-topped steel barrel with a raised
 *  gold Templar cross, a dark sight slit, breathing-hole dots and a riveted
 *  rim. (The cross/eyes are the accent, so the colour picker recolours them.) */
function buildKnightHead(accent: number): Group {
  const r = BODY_IK.headRadius;
  const g = taggedHead('knight');

  // Flat-topped barrel helm fully enclosing the head, capped flat with a seam.
  const barrel = new Mesh(new CylinderGeometry(r * 0.98, r * 1.06, r * 1.7, 20), chassisMat(accent, 0.04));
  barrel.position.y = r * 0.3;
  g.add(barrel);
  const cap = new Mesh(new CylinderGeometry(r * 0.99, r * 0.98, r * 0.16, 20), chassisMat(accent, 0.04));
  cap.position.y = r * 1.2;
  g.add(cap);
  const ridge = new Mesh(new BoxGeometry(r * 0.12, r * 0.1, r * 2.05), chassisMat(accent, 0.05));
  ridge.position.set(0, r * 1.27, 0);
  g.add(ridge);

  // The raised TEMPLAR CROSS: a long vertical bar + a crossbar at the sight line.
  const vbar = new Mesh(new BoxGeometry(r * 0.3, r * 1.78, r * 0.08), glowMat(accent, 0.85));
  vbar.position.set(0, r * 0.32, -r * 1.06);
  g.add(vbar);
  const hbar = new Mesh(new BoxGeometry(r * 1.85, r * 0.28, r * 0.08), glowMat(accent, 0.85));
  hbar.position.set(0, r * 0.5, -r * 1.085);
  g.add(hbar);

  // The sight: a dark slit either side of the cross, with a faint eye glow so
  // it still reads alive across the gap.
  for (const side of [-1, 1]) {
    const slit = new Mesh(new BoxGeometry(r * 0.6, r * 0.13, r * 0.08), darkMat());
    slit.position.set(side * r * 0.52, r * 0.34, -r * 1.04);
    g.add(slit);
    const eye = new Mesh(new BoxGeometry(r * 0.48, r * 0.05, r * 0.05), glowMat(accent, 1.4));
    eye.position.set(side * r * 0.52, r * 0.34, -r * 1.075);
    g.add(eye);
  }

  // Breathing holes — clustered dark studs across the lower face, both sides.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const hole = new Mesh(new CylinderGeometry(r * 0.05, r * 0.05, r * 0.05, 7), darkMat());
      hole.rotation.x = Math.PI / 2;
      hole.position.set(side * (r * 0.24 + col * r * 0.14), -r * 0.06 - row * r * 0.17 - col * r * 0.04, -r * 1.05);
      g.add(hole);
    }
  }

  // Riveted lower-front rim.
  for (let i = 0; i < 13; i++) {
    const a = -Math.PI * 0.6 + (i / 12) * Math.PI * 1.2;
    const stud = new Mesh(new SphereGeometry(r * 0.045, 6, 5), chassisMat(accent, 0.06));
    stud.position.set(Math.sin(a) * r * 1.04, -r * 0.5, -Math.cos(a) * r * 1.06);
    g.add(stud);
  }

  // Gorget neck base flaring under the helm.
  const gorget = new Mesh(new CylinderGeometry(r * 0.72, r * 0.9, r * 0.34, 16), darkMat());
  gorget.position.y = -r * 0.64;
  g.add(gorget);
  return g;
}

/** KNIGHT cuirass: a tall riveted gorget, rounded dome pauldrons (true
 *  half-shells with a rim lip, studded crowns + lower lames — a touch smaller
 *  than the original full balls), and the studded chest yoke ending in a
 *  pointed plate. */
function buildKnightChest(accent: number): Group {
  const g = taggedHead('knight');

  // Tall riveted gorget collar.
  const gorget = new Mesh(new CylinderGeometry(0.12, 0.16, 0.17, 16), chassisMat(accent, 0.05));
  gorget.position.y = 0.12;
  g.add(gorget);
  const neck = new Mesh(new CylinderGeometry(0.07, 0.085, 0.08, 8), darkMat());
  neck.position.y = 0.2;
  g.add(neck);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const stud = new Mesh(new SphereGeometry(0.011, 6, 5), chassisMat(accent, 0.07));
    stud.position.set(Math.sin(a) * 0.135, 0.18, -Math.cos(a) * 0.135);
    g.add(stud);
  }

  // Dome pauldrons — the rounded shells, back by request, but shaped better:
  // a true half-dome cut (not a full ball) tilted down the arm, a steel rim
  // lip at the cut edge, a dark under-fill so the shell never reads hollow,
  // studs riding the crown and two lames beneath. Slightly smaller than the
  // originals (r 0.15 vs 0.17).
  for (const side of [-1, 1]) {
    const sh = new Group();
    sh.position.set(side * 0.26, 0.1, 0);
    sh.rotation.z = side * -0.22; // tilt the shell over the arm
    g.add(sh);
    const dome = new Mesh(
      new SphereGeometry(0.15, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6),
      chassisMat(accent, 0.05),
    );
    dome.scale.set(1, 0.78, 1.1);
    sh.add(dome);
    const fill = new Mesh(new SphereGeometry(0.125, 12, 9), darkMat());
    fill.scale.set(1, 0.62, 1.05);
    fill.position.y = -0.02;
    sh.add(fill);
    // Rim lip ringing the dome's cut edge (the elliptical footprint).
    const lip = new Mesh(new CylinderGeometry(0.148, 0.153, 0.028, 18), chassisMat(accent, 0.06));
    lip.scale.z = 1.1;
    lip.position.y = -0.038;
    sh.add(lip);
    // Studs riding the crown, front to back along the shell's surface.
    for (let i = 0; i < 4; i++) {
      const z = -0.09 + i * 0.06;
      const y = 0.78 * Math.sqrt(Math.max(0, 0.15 ** 2 - (z / 1.1) ** 2)) + 0.006;
      const stud = new Mesh(new SphereGeometry(0.011, 6, 5), chassisMat(accent, 0.07));
      stud.position.set(0, y, z);
      sh.add(stud);
    }
    // Two lames stepping down under the rim.
    for (let j = 0; j < 2; j++) {
      const lame = new Mesh(new BoxGeometry(0.19 - j * 0.02, 0.05, 0.17), chassisMat(accent, 0.04));
      lame.position.set(side * 0.015, -0.075 - j * 0.055, 0);
      lame.rotation.z = side * 0.1;
      sh.add(lame);
    }
  }

  // Studded chest yoke ending in a pointed (V) plate.
  const yoke = new Mesh(new BoxGeometry(0.36, 0.17, 0.07), chassisMat(accent, 0.05));
  yoke.position.set(0, 0.01, -0.13);
  g.add(yoke);
  const point = new Mesh(new ConeGeometry(0.13, 0.18, 4), chassisMat(accent, 0.05));
  point.scale.set(1, 1, 0.5);
  point.rotation.set(Math.PI, Math.PI / 4, 0); // 4-sided plate, apex pointing DOWN
  point.position.set(0, -0.14, -0.12);
  g.add(point);
  for (let i = 0; i < 6; i++) {
    const stud = new Mesh(new SphereGeometry(0.012, 6, 5), chassisMat(accent, 0.07));
    stud.position.set(-0.14 + i * 0.056, 0.07, -0.165);
    g.add(stud);
  }
  for (const side of [-1, 1]) {
    for (let j = 0; j < 2; j++) {
      const stud = new Mesh(new SphereGeometry(0.012, 6, 5), chassisMat(accent, 0.07));
      stud.position.set(side * 0.16, 0.02 - j * 0.06, -0.165);
      g.add(stud);
    }
  }

  // Lower body trunk + side flanks under the yoke.
  const trunk = new Mesh(new CylinderGeometry(0.16, 0.09, 0.4, 10), darkMat());
  trunk.scale.z = 0.7;
  trunk.position.y = -0.16;
  g.add(trunk);
  for (const side of [-1, 1]) {
    const flank = new Mesh(new BoxGeometry(0.05, 0.26, 0.2), chassisMat(accent, 0.04));
    flank.position.set(side * 0.15, -0.1, 0);
    flank.rotation.z = side * 0.12;
    g.add(flank);
  }
  return g;
}

/** KNIGHT hips: a plated fauld (overlapping lames) with broad tassets. */
function buildKnightPelvis(accent: number): Group {
  const g = taggedHead('knight');
  const belt = new Mesh(new BoxGeometry(0.23, 0.06, 0.17), chassisMat(accent, 0.04));
  belt.position.y = 0.05;
  g.add(belt);
  const buckle = new Mesh(new BoxGeometry(0.06, 0.05, 0.03), glowMat(accent, 1.1));
  buckle.position.set(0, 0.05, -0.095);
  g.add(buckle);
  // Fauld: a stack of overlapping horizontal plates curving round the front.
  for (let i = 0; i < 3; i++) {
    const lame = new Mesh(new BoxGeometry(0.24 - i * 0.02, 0.06, 0.16), chassisMat(accent, 0.03));
    lame.position.set(0, 0.0 - i * 0.05, -0.005);
    lame.rotation.x = -0.05;
    g.add(lame);
  }
  // Broad tassets guarding the thighs.
  for (const side of [-1, 1]) {
    const tasset = new Mesh(new BoxGeometry(0.1, 0.17, 0.13), chassisMat(accent, 0.04));
    tasset.position.set(side * 0.11, -0.06, 0);
    tasset.rotation.z = side * 0.22;
    g.add(tasset);
    const trim = new Mesh(new BoxGeometry(0.11, 0.015, 0.135), glowMat(accent, 0.4));
    trim.position.set(side * 0.13, -0.145, 0);
    trim.rotation.z = side * 0.22;
    g.add(trim);
  }
  return g;
}


/** One cross-section of the lofted horse skull: the topline point (forehead /
 *  nasal bridge) and underline point (throat / jaw / chin) in the sagittal
 *  plane as [y, z] (in headRadius units), the half-width at that station, and
 *  a superellipse exponent (2 = ellipse, higher = flatter-sided). */
interface HeadStation {
  top: [number, number];
  bot: [number, number];
  w: number;
  n: number;
}

/** Loft a smooth, capped skin over a run of head stations. Each station
 *  becomes a ring of `seg` vertices: a superellipse stretched between its
 *  topline and underline points — so the section PLANES tilt with the face
 *  (a horse's face plane leans forward-down) and the width/roundness vary
 *  station to station. Rings are stitched into quads and both ends fan-capped. */
function loftGeometry(stations: HeadStation[], scale: number, seg = 22): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const st of stations) {
    const midY = (st.top[0] + st.bot[0]) / 2;
    const midZ = (st.top[1] + st.bot[1]) / 2;
    const hy = (st.top[0] - st.bot[0]) / 2;
    const hz = (st.top[1] - st.bot[1]) / 2;
    const e = 2 / st.n;
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const u = Math.sign(c) * Math.abs(c) ** e;
      const v = Math.sign(s) * Math.abs(s) ** e;
      pos.push(st.w * u * scale, (midY + hy * v) * scale, (midZ + hz * v) * scale);
    }
  }
  for (let i = 0; i < stations.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const j2 = (j + 1) % seg;
      const a = i * seg + j;
      const b = i * seg + j2;
      const c = (i + 1) * seg + j;
      const d = (i + 1) * seg + j2;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Fan caps over the first (back of skull) and last (nose tip) rings.
  const backCentre = pos.length / 3;
  const s0 = stations[0];
  pos.push(0, ((s0.top[0] + s0.bot[0]) / 2) * scale, ((s0.top[1] + s0.bot[1]) / 2) * scale);
  const noseCentre = pos.length / 3;
  const sn = stations[stations.length - 1];
  pos.push(0, ((sn.top[0] + sn.bot[0]) / 2) * scale, ((sn.top[1] + sn.bot[1]) / 2) * scale);
  const last = (stations.length - 1) * seg;
  for (let j = 0; j < seg; j++) {
    const j2 = (j + 1) % seg;
    idx.push(backCentre, j, j2);
    idx.push(noseCentre, last + j2, last + j);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** STALLION → the iron horse, built for anatomical accuracy: one smooth
 *  lofted skull that is genuinely horse-shaped — a broad flat forehead
 *  between high side-set eyes, a long straight nasal bridge tapering to a
 *  narrow soft muzzle with flared nostrils and a round chin, big jowl discs
 *  at the back of the jaw (the widest part of the head), close-set curved
 *  ears on the poll, a forelock and a swept mane crest down the nape. */
function buildStallionHead(accent: number): Group {
  const r = BODY_IK.headRadius;
  const g = taggedHead('stallion');
  g.scale.setScalar(1.25); // carried proud — reads bigger than the hitbox sphere

  // The skull loft, back of head → nose tip. Stations traced from a real
  // head: the wedge is widest at the brow/jowls and tapers steadily down the
  // (slightly convex) nasal bridge; the underline sweeps from the round
  // throat forward along the jaw to the chin; a gentle re-flare at the
  // nostril station before the nose rounds off.
  const skull = new Mesh(
    loftGeometry(
      [
        { top: [0.88, 0.42], bot: [0.1, 0.52], w: 0.26, n: 2.0 }, // occiput
        { top: [1.02, 0.22], bot: [-0.05, 0.4], w: 0.36, n: 2.0 }, // poll
        { top: [0.98, -0.02], bot: [-0.22, 0.26], w: 0.44, n: 2.1 }, // temples
        { top: [0.74, -0.3], bot: [-0.34, 0.1], w: 0.47, n: 2.2 }, // brow (widest)
        { top: [0.52, -0.5], bot: [-0.42, -0.05], w: 0.42, n: 2.2 }, // orbits
        { top: [0.22, -0.76], bot: [-0.52, -0.32], w: 0.33, n: 2.1 }, // cheekbone
        { top: [-0.06, -0.97], bot: [-0.62, -0.62], w: 0.27, n: 2.0 }, // mid face
        { top: [-0.3, -1.15], bot: [-0.72, -0.92], w: 0.225, n: 1.9 }, // upper muzzle
        { top: [-0.45, -1.27], bot: [-0.79, -1.1], w: 0.235, n: 1.85 }, // nostril flare
        { top: [-0.58, -1.37], bot: [-0.85, -1.24], w: 0.185, n: 1.8 }, // nose
        { top: [-0.68, -1.41], bot: [-0.84, -1.33], w: 0.1, n: 1.7 }, // tip
      ],
      r,
    ),
    chassisMat(accent, 0.06),
  );
  g.add(skull);

  // Jowls: the big round masseter discs at the back of the jaw — in a real
  // head these are the widest thing below the eyes. Flattened and tucked into
  // the skull sides so they read as cheek muscle, not add-on bubbles.
  for (const side of [-1, 1]) {
    const jowl = new Mesh(new SphereGeometry(r * 0.36, 18, 14), chassisMat(accent, 0.05));
    jowl.scale.set(0.38, 1.0, 0.92);
    jowl.position.set(side * r * 0.27, r * 0.0, r * 0.02);
    jowl.rotation.x = 0.35; // long axis leaning with the jawline
    g.add(jowl);
  }

  // Eyes: set HIGH and WIDE at the brow corners, looking out to the sides —
  // a dark socket ring with the eye itself bulging just proud of the skull
  // like a real horse's. The lofted brow corner plays the bone above them.
  for (const side of [-1, 1]) {
    const socket = new Mesh(new SphereGeometry(r * 0.15, 14, 12), darkMat());
    socket.scale.set(0.5, 1.0, 0.9);
    socket.position.set(side * r * 0.43, r * 0.34, -r * 0.42);
    socket.rotation.y = side * -0.45;
    g.add(socket);
    const eye = new Mesh(new SphereGeometry(r * 0.11, 14, 12), glowMat(accent, 2.6));
    eye.scale.set(0.6, 1.0, 0.85);
    eye.position.set(side * r * 0.465, r * 0.335, -r * 0.44);
    eye.rotation.y = side * -0.45;
    g.add(eye);
  }

  // Ears: close-set on the poll, tall and alert, elliptical in section with
  // a dark inner scoop facing forward — set as a shadow inside the rim, not
  // a black slab. Bases sink into the poll so they grow from the head.
  for (const side of [-1, 1]) {
    const ear = new Mesh(new ConeGeometry(r * 0.17, r * 0.62, 10), chassisMat(accent, 0.05));
    ear.scale.z = 0.75;
    ear.position.set(side * r * 0.24, r * 1.14, r * 0.1);
    ear.rotation.set(0.12, 0, side * -0.12);
    g.add(ear);
    const inner = new Mesh(new ConeGeometry(r * 0.08, r * 0.4, 10), darkMat());
    inner.scale.z = 0.55;
    inner.position.set(side * r * 0.245, r * 1.1, r * 0.055);
    inner.rotation.set(0.12, 0, side * -0.12);
    g.add(inner);
  }

  // Nostrils: large comma-shaped dark openings set into the SIDES of the
  // muzzle, each with a raised outer rim so the flare reads in silhouette.
  for (const side of [-1, 1]) {
    const rim = new Mesh(new SphereGeometry(r * 0.13, 12, 10), chassisMat(accent, 0.05));
    rim.scale.set(0.45, 1.2, 0.8);
    rim.position.set(side * r * 0.215, -r * 0.53, -r * 1.26);
    rim.rotation.set(0.55, side * -0.35, side * 0.25);
    g.add(rim);
    const nostril = new Mesh(new SphereGeometry(r * 0.115, 12, 10), darkMat());
    nostril.scale.set(0.5, 1.15, 0.75);
    nostril.position.set(side * r * 0.185, -r * 0.53, -r * 1.3);
    nostril.rotation.set(0.55, side * -0.35, side * 0.25);
    g.add(nostril);
  }

  // The soft chin knob under the lower lip, and the mouth seam above it.
  const chin = new Mesh(new SphereGeometry(r * 0.15, 12, 10), chassisMat(accent, 0.05));
  chin.scale.set(0.85, 0.7, 0.9);
  chin.position.set(0, -r * 0.86, -r * 1.13);
  g.add(chin);
  const mouth = new Mesh(new BoxGeometry(r * 0.3, r * 0.035, r * 0.22), darkMat());
  mouth.position.set(0, -r * 0.79, -r * 1.27);
  mouth.rotation.x = 0.5;
  g.add(mouth);

  // The BLAZE: the white face-marking as a soft glow strip — a star on the
  // forehead, narrowing between the eyes, widest mid-face and fading out
  // above the nostrils, hugging the slope of the nasal bridge.
  const star = new Mesh(new BoxGeometry(r * 0.11, r * 0.11, r * 0.02), glowMat(accent, 0.7));
  star.position.set(0, r * 0.66, -r * 0.4);
  star.rotation.set(0.75, 0, Math.PI / 4);
  g.add(star);
  const blazeSegs: Array<[[number, number], [number, number], number]> = [
    [[0.6, -0.42], [0.1, -0.85], 0.065], // brow → cheek line
    [[0.1, -0.85], [-0.34, -1.18], 0.095], // widest, mid-face
    [[-0.34, -1.18], [-0.5, -1.31], 0.07], // fading above the nostrils
  ];
  for (const [hi, lo, w] of blazeSegs) {
    const dy = hi[0] - lo[0];
    const dz = hi[1] - lo[1];
    const len = Math.hypot(dy, dz);
    const theta = Math.atan2(dz, dy); // +Y of the plate runs up the bridge
    const strip = new Mesh(new BoxGeometry(r * w, r * len, r * 0.02), glowMat(accent, 0.7));
    // Centre on the topline, nudged out along the face normal so it sits
    // proud of the lofted bridge instead of sinking into it.
    strip.position.set(
      0,
      ((hi[0] + lo[0]) / 2 + Math.sin(theta) * 0.012) * r,
      ((hi[1] + lo[1]) / 2 - Math.cos(theta) * 0.012) * r,
    );
    strip.rotation.x = theta;
    g.add(strip);
  }

  // Forelock: narrow dark wisps spilling from between the ears down over the
  // flat of the forehead, each turned a touch so none reads as a flat mirror.
  for (const [dx, rotY, len] of [
    [0, 0.18, 0.46],
    [-0.11, -0.3, 0.4],
    [0.12, 0.35, 0.38],
  ]) {
    const wisp = new Mesh(new BoxGeometry(r * 0.09, r * len, r * 0.05), darkMat());
    wisp.position.set(dx * r, r * 0.92, -r * 0.22);
    wisp.rotation.set(0.72, rotY, dx * -1.2);
    g.add(wisp);
  }

  // The MANE: overlapping dark plates cresting the poll and sweeping down
  // the nape, each carrying a thin accent filament so the crest still reads
  // across the arena.
  for (let i = 0; i < 6; i++) {
    const len = r * (0.62 - i * 0.04);
    const plate = new Mesh(new BoxGeometry(r * 0.1, len, r * 0.24), darkMat());
    plate.position.set(0, r * (1.1 - i * 0.15), r * (0.26 + i * 0.15));
    plate.rotation.x = 0.55 + i * 0.12;
    g.add(plate);
    const vane = new Mesh(new BoxGeometry(r * 0.035, len * 0.85, r * 0.25), glowMat(accent, 0.5));
    vane.position.set(0, r * (1.115 - i * 0.15), r * (0.26 + i * 0.15));
    vane.rotation.x = 0.55 + i * 0.12;
    g.add(vane);
  }
  return g;
}

/** STALLION cuirass: parade tack — crossed breast-straps meeting at a glowing
 *  chest medallion, sleek shoulder plates, a girth-banded trunk. */
function buildStallionChest(accent: number): Group {
  const g = taggedHead('stallion');
  const collar = new Mesh(new BoxGeometry(0.4, 0.08, 0.19), chassisMat(accent, 0.05));
  collar.position.y = 0.11;
  g.add(collar);
  const neck = new Mesh(new CylinderGeometry(0.065, 0.085, 0.1, 8), darkMat());
  neck.position.y = 0.17;
  g.add(neck);

  // Sleek swept shoulder plates with a glow lip.
  for (const side of [-1, 1]) {
    const pad = new Mesh(new BoxGeometry(0.2, 0.08, 0.27), chassisMat(accent, 0.05));
    pad.position.set(side * 0.27, 0.12, 0);
    pad.rotation.z = side * -0.24;
    g.add(pad);
    const lip = new Mesh(new BoxGeometry(0.205, 0.015, 0.275), glowMat(accent, 0.5));
    lip.position.set(side * 0.27, 0.165, 0);
    lip.rotation.z = side * -0.24;
    g.add(lip);
  }

  const trunk = new Mesh(new CylinderGeometry(0.155, 0.085, 0.42, 8), darkMat());
  trunk.scale.z = 0.74;
  trunk.position.y = -0.13;
  g.add(trunk);

  // The tack: two breast-straps crossing from the shoulders down to the
  // sternum, meeting at a glowing medallion — parade harness in steel.
  for (const side of [-1, 1]) {
    const strap = new Mesh(new BoxGeometry(0.05, 0.3, 0.03), chassisMat(accent, 0.05));
    strap.position.set(side * 0.09, 0.05, -0.145);
    strap.rotation.z = side * 0.55;
    g.add(strap);
    for (let i = 0; i < 2; i++) {
      const stud = new Mesh(new SphereGeometry(0.011, 6, 5), chassisMat(accent, 0.07));
      stud.position.set(side * (0.05 + i * 0.09), 0.11 - i * 0.1, -0.165);
      g.add(stud);
    }
  }
  const medallion = new Mesh(new CylinderGeometry(0.032, 0.032, 0.03, 12), glowMat(accent, 1.4));
  medallion.rotation.x = Math.PI / 2;
  medallion.position.set(0, -0.02, -0.16);
  g.add(medallion);

  // Girth bands ringing the lower trunk.
  for (let i = 0; i < 2; i++) {
    const w = 0.2 - i * 0.04;
    const band = new Mesh(new BoxGeometry(w, 0.05, 0.08), chassisMat(accent, 0.04));
    band.position.set(0, -0.17 - i * 0.09, -0.1);
    g.add(band);
    const seam = new Mesh(new BoxGeometry(w * 0.9, 0.01, 0.082), glowMat(accent, 0.35));
    seam.position.set(0, -0.195 - i * 0.09, -0.1);
    g.add(seam);
  }
  for (const side of [-1, 1]) {
    const flank = new Mesh(new BoxGeometry(0.045, 0.26, 0.2), chassisMat(accent, 0.04));
    flank.position.set(side * 0.14, -0.08, 0);
    flank.rotation.z = side * 0.13;
    g.add(flank);
  }
  return g;
}

/** STALLION hips: a tack belt with a medallion buckle, tapered guard and
 *  swept glow-edged tassets. */
function buildStallionPelvis(accent: number): Group {
  const g = taggedHead('stallion');
  const belt = new Mesh(new BoxGeometry(0.2, 0.05, 0.16), chassisMat(accent, 0.04));
  belt.position.y = 0.05;
  g.add(belt);
  const buckle = new Mesh(new CylinderGeometry(0.026, 0.026, 0.03, 10), glowMat(accent, 1.1));
  buckle.rotation.x = Math.PI / 2;
  buckle.position.set(0, 0.05, -0.085);
  g.add(buckle);
  const guard = new Mesh(new CylinderGeometry(0.08, 0.03, 0.14, 6), chassisMat(accent, 0.03));
  guard.position.set(0, -0.05, -0.02);
  g.add(guard);
  for (const side of [-1, 1]) {
    const tasset = new Mesh(new BoxGeometry(0.055, 0.17, 0.12), chassisMat(accent, 0.04));
    tasset.position.set(side * 0.1, -0.05, 0);
    tasset.rotation.z = side * 0.3;
    g.add(tasset);
    const edge = new Mesh(new BoxGeometry(0.06, 0.013, 0.125), glowMat(accent, 0.4));
    edge.position.set(side * 0.12, -0.125, 0);
    edge.rotation.z = side * 0.3;
    g.add(edge);
  }
  return g;
}

/** Per-skin builders, keyed by skin id — pick one (a fixed wearer) or all
 *  four (the customisation mirror, which toggles between them live). */
const HEAD_BUILDERS: Record<string, (accent: number) => Group> = {
  cobalt: buildBearHead,
  crimson: buildPantherHead,
  valkyrie: buildEagleHead,
  knight: buildKnightHead,
  stallion: buildStallionHead,
};
const CHEST_BUILDERS: Record<string, (accent: number) => Group> = {
  cobalt: buildBearChest,
  crimson: buildPantherChest,
  valkyrie: buildEagleChest,
  knight: buildKnightChest,
  stallion: buildStallionChest,
};
const PELVIS_BUILDERS: Record<string, (accent: number) => Group> = {
  cobalt: buildBearPelvis,
  crimson: buildPantherPelvis,
  valkyrie: buildEaglePelvis,
  knight: buildKnightPelvis,
  stallion: buildStallionPelvis,
};
const ALL_SKIN_IDS = ['cobalt', 'crimson', 'valkyrie', 'knight', 'stallion'];

/**
 * Build the full opponent rig. Pieces start hidden; add them to the scene.
 *
 * Pass `skinId` when the wearer never changes skin (a pub punter, the bartender,
 * a chosen fighter) and ONLY that skin's head/cuirass/hips are built — and shown
 * straight away. With no `skinId` all three are built (two left hidden) so the
 * customisation mirror can flip between them live; `applyAvatarSkin` reveals one.
 * Building just the one avoids carrying two extra skins' geometry per rig — a
 * real saving with a roomful of punters.
 */
export function buildBoxer(team: number, skinId?: string): BoxerRig {
  const accent = teamColor(team);
  const ids = skinId && HEAD_BUILDERS[skinId] ? [skinId] : ALL_SKIN_IDS;
  const sole = ids.length === 1; // the one built skin shows without applyAvatarSkin

  // --- Head: a detailed metallic ANIMAL head per built skin (front is −z).
  //     Hitboxes are the BODY_IK spheres and never change, so every fighter is
  //     equally hittable whatever's built. ---
  const head = new Group();
  head.name = 'opponent-head';
  for (const id of ids) {
    const g = HEAD_BUILDERS[id](accent);
    if (sole) g.visible = true;
    head.add(g);
  }

  // --- Torso: a DISTINCT armoured cuirass + hip set per built skin. Same
  //     silhouette envelope and BODY_IK hitbox spheres, equally hittable. ---
  const chest = new Group();
  chest.name = 'opponent-chest';
  for (const id of ids) {
    const g = CHEST_BUILDERS[id](accent);
    if (sole) g.visible = true;
    chest.add(g);
  }

  const pelvis = new Group();
  pelvis.name = 'opponent-pelvis';
  for (const id of ids) {
    const g = PELVIS_BUILDERS[id](accent);
    if (sole) g.visible = true;
    pelvis.add(g);
  }

  const torso = new Group();
  torso.name = 'opponent-torso';
  torso.add(chest, pelvis);

  // Articulated VR hands (left thumb +x, right thumb -x), not gauntlets.
  const gloves: [Group, Group] = [buildHand(1), buildHand(-1)];
  gloves[0].name = 'opponent-glove-left';
  gloves[1].name = 'opponent-glove-right';

  return { head, torso, chest, pelvis, gloves, all: [head, torso, gloves[0], gloves[1]] };
}

const UP = new Vector3(0, 1, 0);
/** Platform top in the solve's local space — the torso never sinks below it. */
const GROUND_Y = 0.14;
const _hips = new Vector3();
const _chest = new Vector3();
const _spine = new Vector3();
const _fwd = new Vector3();
const _anchor = new Vector3();
const _tilt = new Quaternion();
const _yaw = new Quaternion();

/**
 * Solve the torso under the head, mirroring PlayerBodySystem: hips over the
 * pad centre (padX/padZ) — but dragged DOWN when the head ducks, so a dodge
 * folds the whole machine instead of leaving the pelvis hanging in the air —
 * chest lerped hips→head, both oriented to the spine lean and the head's yaw.
 *
 * The spine hangs from a point slightly BEHIND the head along its yaw
 * (faces sit forward of spines): looking down shows the player the front of
 * their own chest instead of the base of their neck, and the torso stops
 * blocking the view of what's in front.
 *
 * That set-back is tuned for the FIRST-PERSON wearer; a third-person viewer
 * just sees the head jutting ahead of the chest, so callers rendering OTHER
 * people (the pub crowd) can pass a smaller `setBackBase` to seat the head
 * more naturally over the shoulders.
 *
 * Returns chest/pelvis world positions for the caller's hitboxes via out args.
 */
export function solveTorso(
  rig: BoxerRig,
  headPos: Vector3,
  headQuat: Quaternion,
  padX: number,
  padZ: number,
  outChest: Vector3,
  outPelvis: Vector3,
  setBackBase: number = BODY_IK.spineSetBack,
): void {
  rig.head.position.copy(headPos);
  rig.head.quaternion.copy(headQuat);

  // Horizontal yaw-forward of the head; the spine anchor sits behind it.
  _fwd.set(0, 0, -1).applyQuaternion(headQuat);
  const hl = Math.hypot(_fwd.x, _fwd.z);
  const nx = hl > 1e-3 ? _fwd.x / hl : 0;
  const nz = hl > 1e-3 ? _fwd.z / hl : -1;
  // How far the head has dropped toward the platform — 0 standing, →1 laid
  // right out. As you go down, the spine anchor backs FURTHER off so the torso
  // stretches flat out BEHIND you along the slab instead of folding straight
  // down through it.
  const duck = Math.min(1, Math.max(0, (BODY_IK.hipHeight - headPos.y + 0.35) / 0.8));
  const setBack = setBackBase + duck * 0.5;
  _anchor.set(headPos.x - nx * setBack, headPos.y, headPos.z - nz * setBack);

  // Hips track the anchor laterally so big leans drag the torso along, and
  // follow it down on a duck — but NEVER below the platform top, so a low
  // lay-out smushes up against the slab rather than clipping through it.
  const hipY = Math.max(GROUND_Y, Math.min(BODY_IK.hipHeight, headPos.y - 0.5));
  _hips.set(padX * 0.4 + _anchor.x * 0.6, hipY, padZ * 0.4 + _anchor.z * 0.6);
  _chest.copy(_hips).lerp(_anchor, BODY_IK.chestAlong);
  _chest.y = Math.max(GROUND_Y + 0.12, _chest.y); // chest stays off the slab too

  // Orientation: lean the chest along the hips→anchor spine, yaw with the head.
  _spine.copy(_anchor).sub(_hips).normalize();
  _tilt.setFromUnitVectors(UP, _spine);
  _yaw.setFromAxisAngle(UP, Math.atan2(-_fwd.x, -_fwd.z));

  // The torso group sits at the world origin, so world coords ARE local here.
  rig.chest.position.copy(_chest);
  rig.chest.quaternion.copy(_tilt).multiply(_yaw);
  rig.pelvis.position.copy(_hips);
  rig.pelvis.quaternion.copy(_yaw);

  outChest.copy(_chest);
  outPelvis.copy(_hips);
}

/**
 * A static, posed bust of YOUR boxer for the lobby customization preview —
 * head over chest over pelvis with both gauntlets up in a guard. Built at the
 * given accent so the slider visibly drives the whole avatar's neon, not just
 * the gloves. Returns one group; scale/position/spin it as you like, and call
 * `setAvatarAccent` on it to recolour live.
 */
export function buildBoxerPreview(accent: number): Group {
  const rig = buildBoxer(0, 'cobalt');

  rig.pelvis.position.set(0, 0, 0);
  rig.chest.position.set(0, 0.4, 0);
  rig.head.position.set(0, 0.78, 0);
  rig.gloves[0].position.set(-0.26, 0.46, -0.14);
  rig.gloves[1].position.set(0.26, 0.46, -0.14);

  const preview = new Group();
  preview.name = 'avatar-preview';
  preview.add(...rig.all); // head, torso (chest+pelvis), both gloves
  setAvatarAccent(preview, accent);
  return preview;
}
