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
import { collapseStatic } from '../arena/merge.js';
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
  g.position.y = 0.02; // just enough lift to clear the yoke

  // (No neck column: the spanning cylinder read as a strange dark cone under
  // the jaw from most angles — the floating-head gap looks cleaner than the
  // fix ever did.)

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

  // CUPPED ears, set wide on the dome's top corners. Built as a cup, not a
  // ball: an outer shell, a bright rim catching the light round its edge, and
  // a dark inner bowl sunk into it. As plain spheres they read as two knobs
  // stuck on a balloon from the only angle that matters — head-on, across the
  // gap.
  for (const side of [-1, 1]) {
    const set = (o: Object3D, z: number): void => {
      o.position.set(side * r * 0.5, r * 0.86, z);
      o.rotation.set(-0.15, side * 0.35, side * -0.12);
    };
    const shell = new Mesh(new SphereGeometry(r * 0.29, 16, 12), chassisMat(accent, 0.05));
    shell.scale.set(1, 1, 0.5);
    set(shell, r * 0.14);
    g.add(shell);
    const rim = new Mesh(new CylinderGeometry(r * 0.29, r * 0.29, r * 0.03, 18, 1, true), glowMat(accent, 0.3));
    rim.scale.set(1, 1, 0.5);
    set(rim, r * 0.14);
    rim.rotation.x += Math.PI / 2; // ring lies in the ear's own plane
    g.add(rim);
    const bowl = new Mesh(new SphereGeometry(r * 0.2, 14, 10), darkMat());
    bowl.scale.set(1, 1, 0.36);
    set(bowl, r * 0.03);
    g.add(bowl);
  }

  // The BROW: a heavy shelf over each eye, dropped at the inner end. A bear's
  // eyes are small, and small eyes on a big smooth dome read as pinpricks with
  // nothing around them — the brow is what turns two dots into a face.
  for (const side of [-1, 1]) {
    const brow = new Mesh(new BoxGeometry(r * 0.34, r * 0.09, r * 0.14), chassisMat(accent, 0.05));
    brow.position.set(side * r * 0.28, r * 0.36, -r * 0.56);
    brow.rotation.set(0.22, side * -0.18, side * 0.2);
    g.add(brow);
  }

  // Eyes: small, close-set and forward — but given a dark socket ring and a
  // pupil so they read as EYES at range instead of two glowing points.
  for (const side of [-1, 1]) {
    const socket = new Mesh(new SphereGeometry(r * 0.135, 14, 12), darkMat());
    socket.scale.set(0.9, 0.95, 0.55);
    socket.position.set(side * r * 0.27, r * 0.19, -r * 0.62);
    g.add(socket);
    // No pupil: the dark socket ring already gives the eye somewhere to sit,
    // and a pupil on top of it reads as a googly stuck to the face.
    const iris = new Mesh(new SphereGeometry(r * 0.095, 14, 12), glowMat(accent, 1.9));
    iris.scale.set(0.9, 0.95, 0.6);
    iris.position.set(side * r * 0.27, r * 0.19, -r * 0.66);
    iris.rotation.y = side * -0.2;
    g.add(iris);
  }

  // JOWLS flanking the muzzle. Head-on, the lofted snout is pure foreshortening
  // — it reads as nothing, which is most of why this head came out a ball. Two
  // masses either side of it give the muzzle an edge to be a muzzle against.
  for (const side of [-1, 1]) {
    const jowl = new Mesh(new SphereGeometry(r * 0.2, 14, 12), chassisMat(accent, 0.05));
    // Long and tucked, not round and proud — as balls they read as a pair of
    // bubbles stuck either side of the nose.
    jowl.scale.set(0.72, 0.7, 1.3);
    jowl.position.set(side * r * 0.2, -r * 0.18, -r * 0.84);
    g.add(jowl);
  }
  // The bridge running up the snout — a low raised ridge, so the top of the
  // muzzle catches a highlight instead of dissolving into the dome. Kept
  // shallow: any taller and it reads as a plate laid on the face.
  const bridge = new Mesh(new BoxGeometry(r * 0.17, r * 0.055, r * 0.6), chassisMat(accent, 0.05));
  bridge.position.set(0, r * 0.04, -r * 0.88);
  bridge.rotation.x = -0.1;
  g.add(bridge);

  // The big nose pad capping the muzzle, with nostrils, and a mouth line under
  // it. (The old philtrum seam plus a chin ball read as a slot with a lump
  // below — a zip, not a face.)
  const nose = new Mesh(new SphereGeometry(r * 0.17, 14, 12), darkMat());
  nose.scale.set(1.3, 0.8, 0.7);
  nose.position.set(0, -r * 0.02, -r * 1.15);
  g.add(nose);
  for (const side of [-1, 1]) {
    const nostril = new Mesh(new SphereGeometry(r * 0.035, 8, 6), chassisMat(accent, 0.02));
    nostril.scale.set(1, 1.2, 0.6);
    nostril.position.set(side * r * 0.075, -r * 0.03, -r * 1.24);
    g.add(nostril);
  }
  const mouth = new Mesh(new BoxGeometry(r * 0.26, r * 0.035, r * 0.05), darkMat());
  mouth.position.set(0, -r * 0.28, -r * 1.1);
  mouth.rotation.x = 0.2;
  g.add(mouth);
  const jaw = new Mesh(new SphereGeometry(r * 0.19, 14, 12), chassisMat(accent, 0.05));
  jaw.scale.set(1, 0.62, 0.9);
  jaw.position.set(0, -r * 0.44, -r * 0.94);
  g.add(jaw);

  // Fur ruffs: thin plates swept BACK along the cheeks and jaw — the shaggy
  // silhouette a real bear carries around its huge masseters, hugging the
  // skull rather than boarding off it. Edged in the accent so the shag reads
  // as separate layers rather than one dark smear against dark steel.
  for (const side of [-1, 1]) {
    const upper = new Mesh(new BoxGeometry(r * 0.05, r * 0.38, r * 0.44), darkMat());
    upper.position.set(side * r * 0.55, -r * 0.2, r * 0.06);
    upper.rotation.set(0.15, side * 0.65, side * 0.3);
    g.add(upper);
    const upperLip = new Mesh(new BoxGeometry(r * 0.012, r * 0.38, r * 0.44), glowMat(accent, 0.22));
    upperLip.position.set(side * r * 0.58, -r * 0.2, r * 0.06);
    upperLip.rotation.copy(upper.rotation);
    g.add(upperLip);
    const lower = new Mesh(new BoxGeometry(r * 0.045, r * 0.3, r * 0.36), darkMat());
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
  g.position.y = 0.015; // just enough lift to clear the yoke

  // (No neck column: the spanning cylinder read as a strange dark cone under
  // the jaw from most angles — the floating-head gap looks cleaner than the
  // fix ever did.)

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
    muff.position.set(side * r * 0.27, r * 0.58, r * 0.06);
    muff.rotation.z = side * -0.15;
    g.add(muff);
    const ear = new Mesh(new ConeGeometry(r * 0.24, r * 0.42, 10), chassisMat(accent, 0.05));
    ear.scale.z = 0.6;
    ear.position.set(side * r * 0.27, r * 0.72, r * 0.07);
    ear.rotation.set(-0.1, 0, side * -0.06);
    g.add(ear);
    const inner = new Mesh(new ConeGeometry(r * 0.15, r * 0.32, 10), darkMat());
    inner.scale.z = 0.5;
    inner.position.set(side * r * 0.28, r * 0.695, r * 0.02);
    inner.rotation.set(-0.1, 0, side * -0.06);
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
 *  beak lofted through its real down-curve (with cere and nostrils), and a
 *  hackle ruff of layered feathers around the nape instead of a fantasy
 *  mohawk. The anatomical lower mandible is deliberately GONE — under the
 *  giant upper beak it read as a small black tab hanging off the face, and
 *  the clean single-wedge profile is the look. */
function buildEagleHead(accent: number): Group {
  const r = BODY_IK.headRadius;
  const g = taggedHead('valkyrie');
  g.scale.setScalar(1.4); // carried proud — a touch under the bear (1.5 read too big)
  g.position.y = 0.05; // highest carry of the three — the low nape ruff needs the clearance

  // (No neck column: the spanning cylinder read as a strange dark cone under
  // the jaw from most angles — the floating-head gap looks cleaner than the
  // fix ever did.)

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
        { top: [0.32, -0.86], bot: [-0.34, -0.68], w: 0.26, n: 2.0 }, // forehead step
        { top: [0.26, -0.96], bot: [-0.3, -0.8], w: 0.2, n: 1.9 }, // cere
      ],
      r,
    ),
    chassisMat(accent, 0.06),
  );
  g.add(skull);

  // The upper beak: HUGE — the face-dominating hooked wedge, deep from
  // culmen to cutting edge, projecting far forward before the tip plunges
  // past the chin line.
  const beak = new Mesh(
    loftGeometry(
      [
        { top: [0.3, -0.85], bot: [-0.45, -0.7], w: 0.24, n: 1.95 }, // buried in the head
        { top: [0.26, -1.22], bot: [-0.5, -1.08], w: 0.2, n: 1.9 }, // culmen holds HIGH…
        { top: [0.08, -1.5], bot: [-0.55, -1.36], w: 0.15, n: 1.8 }, // …arching forward…
        { top: [-0.28, -1.68], bot: [-0.6, -1.54], w: 0.09, n: 1.75 }, // …then breaking over
        { top: [-0.64, -1.66], bot: [-0.69, -1.56], w: 0.03, n: 1.7 }, // the hook, plunging
      ],
      r,
    ),
    chassisMat(accent, 0.09),
  );
  g.add(beak);

  // (No lower mandible — see the note above. The upper beak carries the face
  // on its own; the cere below still closes the head/beak seam.)

  // Cere saddle wrapping the beak root, hiding the head/beak seam, with the
  // two nostril slits ahead of it.
  const cere = new Mesh(new SphereGeometry(r * 0.15, 12, 10), darkMat());
  cere.scale.set(1.2, 0.6, 0.9);
  cere.position.set(0, r * 0.24, -r * 0.86);
  cere.rotation.x = 0.5;
  g.add(cere);
  for (const side of [-1, 1]) {
    const nostril = new Mesh(new SphereGeometry(r * 0.04, 8, 6), darkMat());
    nostril.scale.set(0.7, 1, 0.6);
    nostril.position.set(side * r * 0.11, r * 0.1, -r * 1.02);
    g.add(nostril);
  }

  // The eyes: BIG — wide expressive ovals under a heavy slanted dark lid
  // (the cartoon-raptor scowl), tucked against the brow shelf.
  for (const side of [-1, 1]) {
    const socket = new Mesh(new SphereGeometry(r * 0.17, 14, 12), darkMat());
    socket.scale.set(0.7, 0.95, 0.85);
    socket.position.set(side * r * 0.3, r * 0.36, -r * 0.52);
    g.add(socket);
    const eye = new Mesh(new SphereGeometry(r * 0.14, 14, 12), glowMat(accent, 2.8));
    eye.scale.set(0.72, 1.0, 0.85);
    eye.position.set(side * r * 0.33, r * 0.35, -r * 0.55);
    eye.rotation.y = side * -0.5;
    g.add(eye);
    // The lid: a dark bar slanting DOWN toward the beak — the glare.
    const lid = new Mesh(new BoxGeometry(r * 0.3, r * 0.09, r * 0.14), darkMat());
    lid.position.set(side * r * 0.28, r * 0.52, -r * 0.56);
    lid.rotation.set(0.25, side * -0.3, side * 0.4);
    g.add(lid);
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

  // The SCRUFF: a ring of jagged feather tips around the base of the head,
  // pointing down and out — the smooth ruff mass above ends in zigzag
  // points, the shaggy collar that sells the eagle's neck.
  const _sDir = new Vector3();
  const _sUp = new Vector3(0, 1, 0);
  for (let i = 0; i < 11; i++) {
    const a = ((35 + i * 29) * Math.PI) / 180; // wraps the neck, skips the beak
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    const len = r * (0.26 + (i % 2) * 0.09); // alternating long/short = the zigzag
    _sDir.set(sx * 0.6, -1, sz * 0.6).normalize();
    const quill = new Mesh(new ConeGeometry(r * 0.125, len, 6), chassisMat(accent, 0.05));
    quill.scale.z = 0.55;
    quill.quaternion.setFromUnitVectors(_sUp, _sDir);
    quill.position
      .set(sx * r * 0.36, -r * 0.38, sz * r * 0.34 + r * 0.1)
      .addScaledVector(_sDir, len / 2);
    g.add(quill);
  }

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
  // (No neck post: its flat cylinder cap peeked out behind the head from
  // above/behind and read as a chopped cone — the open join looks cleaner.)

  // The torso core: a vertical loft, shoulders → waist. The first ring tilts
  // back-up into the shoulder HUMP; the barrel is deepest at the pecs and
  // pinches hard to the waist.
  const core = new Mesh(
    loftGeometry(
      [
        // Scale first, shape second. This hull used to run 0.265 wide by 0.20
        // deep at the barrel — THREE TIMES the cross-section of the panther's
        // trunk and every other fighter's. No amount of plating rescues a body
        // that is three times the size of the ones beside it; it just reads as
        // chunky. Brought to ~1.35x the panther: still plainly the heaviest
        // frame on the roster, and now in the same family as the rest of it.
        // The breadth that says "bear" lives in the SHOULDERS instead, which
        // still reach as wide as anyone's.
        { top: [0.24, -0.035], bot: [0.27, 0.115], w: 0.115, n: 2.0 }, // neck ring → hump
        { top: [0.16, -0.115], bot: [0.18, 0.135], w: 0.185, n: 2.1 }, // shoulder line
        { top: [0.04, -0.142], bot: [0.05, 0.122], w: 0.18, n: 2.1 }, // the barrel (deepest)
        { top: [-0.12, -0.128], bot: [-0.12, 0.108], w: 0.16, n: 2.05 }, // ribs
        // The waist also used to pinch to 0.12 against a 0.30 shoulder — a
        // taper that steep is a TEARDROP. Held in proportion now.
        { top: [-0.28, -0.095], bot: [-0.28, 0.095], w: 0.125, n: 2.0 }, // waist
        { top: [-0.31, -0.092], bot: [-0.31, 0.092], w: 0.12, n: 2.0 }, // hem — flat cut below the band
      ],
      1,
    ),
    chassisMat(accent, 0.05),
  );
  g.add(core);

  // The hump proper stays organic muscle behind the neck (re-fitted to the
  // slimmer hull — at its old size it stood out past the shoulders).
  const hump = new Mesh(new SphereGeometry(0.076, 16, 12), chassisMat(accent, 0.05));
  hump.scale.set(1.2, 0.6, 0.9);
  hump.position.set(0, 0.2, 0.055);
  g.add(hump);

  // Bespoke PAULDRONS: a domed crown shell with two smaller shells lapped
  // tight beneath it, wrapping the shoulder's curve — heavy bear armour.
  //
  // These were flat (y-scale 0.55 and falling) and fanned outward on a rising
  // tilt, which read as a pair of feathered WINGS rather than shoulder plate.
  // Domed, pulled in against the shoulder and barely tilted, they lap.
  // TWO plates, not three, and only the lower one carries a lit edge. Three
  // lapped shells each ringed in neon gave every shoulder a stack of parallel
  // bright lines — which is precisely how a feathered WING is drawn, and it
  // was the single biggest reason this body read wrong.
  // These keep their reach — the shoulders are where a bear carries its
  // breadth, and they still span as wide as any other fighter's pads. It is
  // the TORSO between them that came down, which is what turns "chunky" into
  // "shoulder-heavy".
  for (const side of [-1, 1]) {
    // Sized to reach the KNIGHT's shoulder line (its dome pauldrons sit at
    // ±0.26 with a 0.15 radius, so its widest point is x ≈ 0.41, and measured
    // on screen it is the broadest body on the roster at 265 px against the
    // bear's 209). The bear matches it here rather than in the torso: the
    // knight carries its width on a slim 0.16 trunk too, and that is what a
    // shoulder-heavy silhouette is — broad up top, not barrel all the way
    // down.
    //
    // A true half-DOME cut, the same construction the knight's pauldrons use —
    // not a sphere stretched sideways to reach the width. Stretching is what
    // turned these into elongated pods with a bright line down them, i.e.
    // wings again: the reach has to come from where the shell SITS, not from
    // scaling it flat.
    const sh = new Group();
    sh.position.set(side * 0.256, 0.13, 0);
    sh.rotation.z = side * -0.16; // tilt the shell over the arm
    g.add(sh);
    const dome = new Mesh(
      new SphereGeometry(0.15, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6),
      chassisMat(accent, 0.05),
    );
    dome.scale.set(1, 0.8, 1.05);
    sh.add(dome);
    // A dark under-fill, so the open dome never reads hollow from below.
    const fill = new Mesh(new SphereGeometry(0.138, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), darkMat());
    fill.scale.set(1, 0.7, 1.05);
    fill.position.y = -0.006;
    sh.add(fill);
    // A lit lip at the dome's cut edge.
    const rim = new Mesh(new CylinderGeometry(0.148, 0.152, 0.014, 20), glowMat(accent, 0.34));
    rim.scale.z = 1.05;
    rim.position.y = -0.012;
    sh.add(rim);
    // Two lames stepping down under it — lapped bear plate.
    for (let j = 0; j < 2; j++) {
      const lame = new Mesh(new BoxGeometry(0.2 - j * 0.03, 0.048, 0.19 - j * 0.02), chassisMat(accent, 0.04));
      lame.position.set(side * 0.012, -0.052 - j * 0.05, 0);
      lame.rotation.z = side * 0.12;
      sh.add(lame);
    }
  }

  // PEC PLATES: the torso loft is one smooth barrel, which on its own reads
  // as a balloon — the whole reason this body looked unfinished next to the
  // panther's plating. Two angled slabs give the chest a front.
  // Re-seated onto the new hull: the barrel's front face is at z −0.142 now,
  // not −0.20, and at the old depth these plates were half BURIED inside it,
  // which is why the chest still read as one smooth mass with rectangles
  // faintly showing through.
  for (const side of [-1, 1]) {
    const pec = new Mesh(new BoxGeometry(0.14, 0.16, 0.065), chassisMat(accent, 0.05));
    pec.position.set(side * 0.078, 0.02, -0.14);
    pec.rotation.set(0.08, side * 0.36, side * 0.14);
    g.add(pec);
  }
  // The sternum seam between them.
  const sternum = new Mesh(new BoxGeometry(0.02, 0.19, 0.03), glowMat(accent, 0.5));
  sternum.position.set(0, 0.01, -0.155);
  g.add(sternum);

  // A short fur fringe under the chest — the flanks stay clean.
  for (let i = -1; i <= 1; i++) {
    const fringe = new Mesh(new BoxGeometry(0.048, 0.1, 0.025), darkMat());
    fringe.position.set(i * 0.062, -0.12, -0.122);
    fringe.rotation.set(0.3, i * 0.25, i * 0.15);
    g.add(fringe);
  }

  // The scars: three claw-mark slashes raked across the LEFT pec — on the
  // plate now, so they read as damage to armour rather than neon stripes
  // drifting on a bare curve.
  for (let i = 0; i < 3; i++) {
    const claw = new Mesh(new BoxGeometry(0.013, 0.095, 0.012), glowMat(accent, 0.9));
    claw.position.set(-0.046 - i * 0.032, 0.045 - i * 0.012, -0.152 + i * 0.005);
    claw.rotation.set(0.12, -0.36, -0.35);
    g.add(claw);
  }
  for (let i = 0; i < 2; i++) {
    const claw = new Mesh(new BoxGeometry(0.012, 0.075, 0.011), glowMat(accent, 0.7));
    claw.position.set(0.1 + i * 0.03, -0.15 - i * 0.01, -0.118 + i * 0.006);
    claw.rotation.set(0.1, 0.25, 0.4);
    g.add(claw);
  }

  // Neon that wraps instead of floats: a collar band where the neck meets
  // the yoke, a waist band at the taper, and three ember studs glowing out
  // of each shoulder boulder like coals in the fur.
  // Both re-fitted to the slimmer hull — a band sized for the old barrel
  // hangs in mid-air off a body this size.
  g.add(glowBand(accent, 0.228, 0.126, 0.086, 0.03, 0.018, 0.85));
  g.add(glowBand(accent, -0.29, 0.128, 0.098, 0.0, 0.016, 0.85));
  for (const side of [-1, 1]) {
    for (let j = 0; j < 3; j++) {
      const ember = new Mesh(new SphereGeometry(0.009, 8, 6), glowMat(accent, 1.6));
      ember.position.set(side * (0.25 + j * 0.042), 0.2 - j * 0.022, -0.04 - j * 0.008);
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
  // (No neck post: its flat cylinder cap peeked out behind the head from
  // above/behind and read as a chopped cone — the open join looks cleaner.)
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
  // (No neck post: its flat cylinder cap peeked out behind the head from
  // above/behind and read as a chopped cone — the open join looks cleaner.)
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
function buildBearPelvis(accent: number): Group {
  // This used to return an EMPTY group — the bear was the only skin on the
  // roster wearing no hips at all, which is most of why its lower half looked
  // unfinished next to everything else. Built heavy to match the shoulders:
  // a thick belt on a big buckle, broad slab tassets, and a fur skirt.
  const g = taggedHead('cobalt');
  const belt = new Mesh(new BoxGeometry(0.22, 0.062, 0.17), chassisMat(accent, 0.04));
  belt.position.y = 0.05;
  g.add(belt);
  const beltGlow = new Mesh(new BoxGeometry(0.225, 0.014, 0.175), glowMat(accent, 0.45));
  beltGlow.position.y = 0.078;
  g.add(beltGlow);
  // A heavy round buckle — the bear's is a boss stud, not the panther's blade.
  const buckle = new Mesh(new SphereGeometry(0.036, 14, 10), glowMat(accent, 1.0));
  buckle.scale.set(1, 0.9, 0.55);
  buckle.position.set(0, 0.05, -0.09);
  g.add(buckle);
  for (const side of [-1, 1]) {
    const tasset = new Mesh(new BoxGeometry(0.085, 0.185, 0.14), chassisMat(accent, 0.04));
    tasset.position.set(side * 0.105, -0.055, 0);
    tasset.rotation.z = side * 0.26;
    g.add(tasset);
    const edge = new Mesh(new BoxGeometry(0.09, 0.014, 0.145), glowMat(accent, 0.4));
    edge.position.set(side * 0.13, -0.14, 0);
    edge.rotation.z = side * 0.26;
    g.add(edge);
  }
  // Shaggy fur hanging off the back of the belt.
  for (let i = -1; i <= 1; i++) {
    const shag = new Mesh(new BoxGeometry(0.06, 0.13, 0.03), darkMat());
    shag.position.set(i * 0.065, -0.03, 0.085);
    shag.rotation.set(-0.2, i * 0.2, i * 0.12);
    g.add(shag);
  }
  return g;
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
  // (No neck post: its flat cylinder cap peeked out behind the head from
  // above/behind and read as a chopped cone — the open join looks cleaner.)
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
  // Bake the 45° spin into the GEOMETRY so the flat faces meet the squash:
  // yawing the MESH put the base's diagonal on the depth axis and the thin
  // scale skewed it — the old chest point read as a wonky triangle jutting out.
  const pointGeo = new ConeGeometry(0.13, 0.18, 4);
  pointGeo.rotateY(Math.PI / 4);
  const point = new Mesh(pointGeo, chassisMat(accent, 0.05));
  point.scale.set(1, 1, 0.5);
  point.rotation.x = Math.PI; // apex pointing DOWN
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

  // THE BACK SHIELD — a heater shield slung across the knight's back (+z is
  // behind him; the head/cross face −z), bearing the same raised Templar
  // cross as the helm. A boxed body + a 4-sided point for the classic
  // rounded-top, tapered-bottom silhouette, a dark bevel behind so it never
  // reads flat, then the glowing cross proud of the face.
  const shield = new Group();
  shield.position.set(0, 0.0, 0.155);
  shield.rotation.x = -0.08; // canted to sit on the back's slope
  g.add(shield);
  const bevel = new Mesh(new BoxGeometry(0.3, 0.34, 0.03), darkMat());
  bevel.position.set(0, 0.02, -0.012);
  shield.add(bevel);
  const body = new Mesh(new BoxGeometry(0.28, 0.3, 0.04), chassisMat(accent, 0.05));
  body.position.set(0, 0.05, 0);
  shield.add(body);
  // Same geometry-baked spin as the chest point — mesh-level yaw + z-squash
  // skewed this into the lopsided triangle poking out of the knight's back.
  const tipGeo = new ConeGeometry(0.16, 0.2, 4);
  tipGeo.rotateY(Math.PI / 4);
  const tip = new Mesh(tipGeo, chassisMat(accent, 0.05));
  tip.scale.set(1, 1, 0.28);
  tip.rotation.x = Math.PI; // apex pointing DOWN
  tip.position.set(0, -0.12, 0.002);
  shield.add(tip);
  // Riveted rim studs up the two long edges.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const stud = new Mesh(new SphereGeometry(0.011, 6, 5), chassisMat(accent, 0.07));
      stud.position.set(side * 0.12, 0.13 - i * 0.07, 0.022);
      shield.add(stud);
    }
  }
  // The raised Templar cross on the boss of the shield (same look as the helm).
  const svbar = new Mesh(new BoxGeometry(0.05, 0.28, 0.03), glowMat(accent, 0.85));
  svbar.position.set(0, 0.04, 0.03);
  shield.add(svbar);
  const shbar = new Mesh(new BoxGeometry(0.2, 0.05, 0.03), glowMat(accent, 0.85));
  shbar.position.set(0, 0.09, 0.03);
  shield.add(shbar);
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

  // (No neck column: the spanning cylinder read as a strange dark cone under
  // the jaw from most angles — the floating-head gap looks cleaner than the
  // fix ever did.)

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
  // Shell + scoop live in ONE pivot group so the dark inner can never drift
  // off the rim — they used to be placed independently and the scoop sat
  // visibly off-axis from the shell.
  for (const side of [-1, 1]) {
    const ear = new Group();
    ear.position.set(side * r * 0.18, r * 1.12, r * 0.08);
    ear.rotation.set(0.12, 0, side * -0.04);
    g.add(ear);
    const shell = new Mesh(new ConeGeometry(r * 0.17, r * 0.62, 10), chassisMat(accent, 0.05));
    shell.scale.z = 0.75;
    shell.position.y = r * 0.02;
    ear.add(shell);
    const inner = new Mesh(new ConeGeometry(r * 0.08, r * 0.4, 10), darkMat());
    inner.scale.z = 0.55;
    inner.position.set(side * r * 0.005, -r * 0.04, -r * 0.045);
    ear.add(inner);
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
  // (No neck post: its flat cylinder cap peeked out behind the head from
  // above/behind and read as a chopped cone — the open join looks cleaner.)

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

/** WOLF (KAVIC) → lofted for accuracy, and MEAN: the lean hunter's skull —
 *  a modest dome, a light stop at the brow, then a LONG tapering muzzle (the
 *  opposite of the bear's short deep one), BIG ears pinned back, slit eyes
 *  glaring under a heavy V-brow, swept cheek ruffs and a layered nape ruff.
 *  The face stays clean — the menace is the glare and the ear set. */
function buildWolfHead(accent: number): Group {
  const r = BODY_IK.headRadius;
  const g = taggedHead('wolf');
  g.scale.setScalar(1.49); // carried big — a hair under the bear's 1.5
  g.position.y = 0.03;

  // The skull loft, occiput → nose tip. Half the head is muzzle: the taper
  // starts at the cheeks and runs shallow and straight — no bear dome, no
  // horse convexity — with only a light dish at the stop.
  const skull = new Mesh(
    loftGeometry(
      [
        { top: [0.42, 0.55], bot: [-0.35, 0.6], w: 0.38, n: 2.0 }, // occiput
        { top: [0.68, 0.28], bot: [-0.48, 0.42], w: 0.46, n: 2.05 }, // crown
        { top: [0.64, -0.02], bot: [-0.52, 0.2], w: 0.5, n: 2.1 }, // cheeks (widest)
        { top: [0.5, -0.3], bot: [-0.5, -0.08], w: 0.44, n: 2.1 }, // brow
        { top: [0.3, -0.52], bot: [-0.46, -0.32], w: 0.3, n: 1.95 }, // the light stop
        { top: [0.18, -0.78], bot: [-0.4, -0.6], w: 0.24, n: 1.9 }, // muzzle root
        { top: [0.1, -1.05], bot: [-0.34, -0.92], w: 0.19, n: 1.85 }, // mid muzzle
        { top: [0.05, -1.28], bot: [-0.26, -1.18], w: 0.14, n: 1.8 }, // toward the nose
        { top: [0.02, -1.38], bot: [-0.2, -1.32], w: 0.09, n: 1.75 }, // tip
      ],
      r,
    ),
    chassisMat(accent, 0.06),
  );
  g.add(skull);

  // Ears PINNED BACK — the aggressive set, not the alert prick — with their
  // bases buried in the crown's midline where the loft is still tall (out at
  // ±0.36r the surface has already fallen away and the outer halves floated).
  // Geometry pre-spun 45° so a flat face fronts before the thin z-squash.
  // Raked back, but with real THICKNESS and a lit inner edge. Squashed to
  // z 0.55 and pinned this far back they were paper triangles from the front
  // — the one view that matters — so the ear reads as a solid wedge now, and
  // the inner cup is edged in the accent to catch the eye.
  for (const side of [-1, 1]) {
    const earGeo = new ConeGeometry(r * 0.3, r * 0.76, 4);
    earGeo.rotateY(Math.PI / 4);
    const ear = new Mesh(earGeo, chassisMat(accent, 0.05));
    ear.scale.set(1, 1, 0.78);
    ear.position.set(side * r * 0.3, r * 0.78, r * 0.22);
    ear.rotation.set(0.2, side * -0.18, side * -0.16); // still raked, less pinned
    g.add(ear);
    // The dark inner sits PROUD of the outer cone's front face (the bigger
    // ear swallowed it and the ears read as flat spikes) — that shadowed
    // cavity is what sells the ear's depth.
    const innerGeo = new ConeGeometry(r * 0.18, r * 0.52, 4);
    innerGeo.rotateY(Math.PI / 4);
    const inner = new Mesh(innerGeo, darkMat());
    inner.scale.set(1, 1, 0.42);
    inner.position.set(side * r * 0.3, r * 0.74, r * 0.02);
    inner.rotation.set(0.2, side * -0.18, side * -0.16);
    g.add(inner);
    const edgeGeo = new ConeGeometry(r * 0.21, r * 0.56, 4);
    edgeGeo.rotateY(Math.PI / 4);
    const edge = new Mesh(edgeGeo, glowMat(accent, 0.28));
    edge.scale.set(1, 1, 0.26);
    edge.position.set(side * r * 0.3, r * 0.74, r * 0.05);
    edge.rotation.set(0.2, side * -0.18, side * -0.16);
    g.add(edge);
  }

  // The GLARE: heavy brow ridges in the angry V — INNER ends dropped hard
  // toward the nose — with narrow slit eyes slanted to match beneath them.
  // (Sign note: the face is on −z and read mirrored; the first cut used the
  // other sign and the brows tilted quizzical, not angry.)
  for (const side of [-1, 1]) {
    const ridge = new Mesh(new BoxGeometry(r * 0.34, r * 0.09, r * 0.13), chassisMat(accent, 0.05));
    ridge.position.set(side * r * 0.22, r * 0.4, -r * 0.48);
    ridge.rotation.set(0.2, 0, side * 0.42);
    g.add(ridge);
    const socket = new Mesh(new SphereGeometry(r * 0.13, 14, 12), darkMat());
    socket.scale.set(1.25, 0.62, 0.6);
    socket.position.set(side * r * 0.25, r * 0.28, -r * 0.52);
    socket.rotation.z = side * 0.42;
    g.add(socket);
    const iris = new Mesh(new SphereGeometry(r * 0.095, 14, 12), glowMat(accent, 2.2));
    iris.scale.set(1.2, 0.5, 0.65);
    iris.position.set(side * r * 0.25, r * 0.28, -r * 0.56);
    iris.rotation.z = side * 0.42;
    g.add(iris);
    // A slit pupil down the middle of the glow — a lit slot with nothing in it
    // just blooms into a white dash at range.
    const pupil = new Mesh(new BoxGeometry(r * 0.032, r * 0.09, r * 0.03), darkMat());
    pupil.position.set(side * r * 0.25, r * 0.28, -r * 0.6);
    pupil.rotation.z = side * 0.42;
    g.add(pupil);
  }

  // The muzzle read. Head-on, a LONG snout is the most foreshortened thing on
  // the head — it was vanishing entirely and leaving an egg. A raised bridge
  // and two lean cheek masses give it edges to be read against.
  const bridge = new Mesh(new BoxGeometry(r * 0.155, r * 0.09, r * 0.78), chassisMat(accent, 0.05));
  bridge.position.set(0, r * 0.09, -r * 0.95);
  bridge.rotation.x = -0.05;
  g.add(bridge);
  for (const side of [-1, 1]) {
    const cheek = new Mesh(new SphereGeometry(r * 0.15, 12, 10), chassisMat(accent, 0.05));
    cheek.scale.set(0.8, 0.85, 1.5);
    cheek.position.set(side * r * 0.16, -r * 0.1, -r * 0.86);
    g.add(cheek);
  }

  // The nose pad, with nostrils. (No wrinkle bars on the bridge — they read as
  // a stray black stripe across the snout, not a snarl scrunch.)
  const nose = new Mesh(new SphereGeometry(r * 0.125, 14, 12), darkMat());
  nose.scale.set(1.15, 0.75, 0.75);
  nose.position.set(0, 0.0, -r * 1.37);
  g.add(nose);
  for (const side of [-1, 1]) {
    const nostril = new Mesh(new SphereGeometry(r * 0.028, 8, 6), chassisMat(accent, 0.02));
    nostril.scale.set(1, 1.2, 0.6);
    nostril.position.set(side * r * 0.055, -r * 0.01, -r * 1.44);
    g.add(nostril);
  }

  // The mouth line — and FANGS. The old note here said fangs never read at
  // this resolution, but that was fangs in dark steel against a dark muzzle;
  // in the accent they read from across the gap the same way OSWALD's teeth
  // do, and a wolf with no teeth was throwing away its best tell.
  const mouth = new Mesh(new BoxGeometry(r * 0.035, r * 0.035, r * 0.62), darkMat());
  mouth.position.set(0, -r * 0.27, -r * 1.02);
  mouth.rotation.x = -0.08;
  g.add(mouth);
  for (const side of [-1, 1]) {
    const fang = new Mesh(new ConeGeometry(r * 0.036, r * 0.125, 4), glowMat(accent, 1.3));
    fang.rotation.set(Math.PI, 0, side * 0.12); // point down
    fang.position.set(side * r * 0.07, -r * 0.32, -r * 1.2);
    g.add(fang);
  }

  // Cheek ruffs swept back and down — leaner, longer sweeps than the bear's.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const ruff = new Mesh(new BoxGeometry(r * 0.045, r * (0.3 - i * 0.06), r * (0.44 - i * 0.08)), darkMat());
      ruff.position.set(side * r * (0.46 - i * 0.04), -r * (0.16 + i * 0.18), r * (0.08 - i * 0.16));
      ruff.rotation.set(0.18, side * 0.7, side * (0.3 + i * 0.2));
      g.add(ruff);
    }
  }
  // The nape ruff: a fan of plates around the back of the skull.
  for (let i = 0; i < 5; i++) {
    const a = ((-40 + i * 20) * Math.PI) / 180;
    const plate = new Mesh(new BoxGeometry(r * 0.14, r * 0.34, r * 0.05), darkMat());
    plate.position.set(Math.sin(a) * r * 0.42, -r * 0.05, r * (0.52 + Math.cos(a) * 0.12));
    plate.rotation.set(0.35, a, 0);
    g.add(plate);
  }
  return g;
}

/** WOLF chest: the panther's bladed cuirass language turned feral — angled
 *  shoulder pads with HACKLE spikes rising off the collar's back edge, sharp
 *  pecs over a dark trunk, chevron abs, an old claw rake glowing on the
 *  right pec and a crescent of moon-embers on the left — the pack mark. */
function buildWolfChest(accent: number): Group {
  const g = taggedHead('wolf');
  const collar = new Mesh(new BoxGeometry(0.4, 0.08, 0.19), chassisMat(accent, 0.05));
  collar.position.y = 0.11;
  g.add(collar);

  // Swept shoulder pads with a glow lip, and a raked-back fur spike off each
  // outer edge — leaner than the panther's upright blade.
  // Swept shoulder pads with a glow lip, and a raked-back fur spike off each
  // outer edge — leaner than the panther's upright blade. Capped with a dome:
  // a bare slab reads as a PLANK bolted to the shoulder, and the wolf's stuck
  // out flatter than anything else on the roster.
  for (const side of [-1, 1]) {
    const pad = new Mesh(new BoxGeometry(0.185, 0.07, 0.25), chassisMat(accent, 0.05));
    pad.position.set(side * 0.26, 0.12, 0);
    pad.rotation.z = side * -0.26;
    g.add(pad);
    const cap = new Mesh(new SphereGeometry(0.098, 16, 12), chassisMat(accent, 0.05));
    cap.scale.set(0.95, 0.52, 1.28);
    cap.position.set(side * 0.26, 0.128, 0);
    cap.rotation.z = side * -0.26;
    g.add(cap);
    const lip = new Mesh(new BoxGeometry(0.19, 0.015, 0.255), glowMat(accent, 0.55));
    lip.position.set(side * 0.265, 0.088, 0);
    lip.rotation.z = side * -0.26;
    g.add(lip);
    const spike = new Mesh(new ConeGeometry(0.028, 0.16, 4), darkMat());
    spike.position.set(side * 0.33, 0.15, 0.06);
    spike.rotation.set(0.6, 0, side * -0.55);
    g.add(spike);
  }
  // HACKLES: raised fur along the back of the collar, tallest at the centre —
  // the wolf's back is up. Three, raked hard back and kept low: five upright
  // spikes across the collar read as a picket fence worn as a necklace.
  for (let i = -1; i <= 1; i++) {
    const hackle = new Mesh(new ConeGeometry(0.026, 0.115 - Math.abs(i) * 0.03, 4), darkMat());
    hackle.position.set(i * 0.085, 0.155, 0.115);
    hackle.rotation.set(0.95, 0, i * 0.2);
    g.add(hackle);
  }

  const trunk = new Mesh(new CylinderGeometry(0.15, 0.075, 0.42, 8), darkMat());
  trunk.scale.z = 0.7;
  trunk.position.y = -0.13;
  g.add(trunk);

  // Sharp angled pecs, panther-style.
  for (const side of [-1, 1]) {
    const pec = new Mesh(new BoxGeometry(0.14, 0.16, 0.06), chassisMat(accent, 0.05));
    pec.position.set(side * 0.08, 0.0, -0.13);
    pec.rotation.set(0.1, side * 0.4, side * 0.12);
    g.add(pec);
  }
  // The old rake: three claw slashes glowing across the right pec…
  for (let i = 0; i < 3; i++) {
    const claw = new Mesh(new BoxGeometry(0.014, 0.1, 0.012), glowMat(accent, 0.85));
    claw.position.set(0.05 + i * 0.04, 0.03 - i * 0.014, -0.175 + i * 0.006);
    claw.rotation.set(0.12, 0, 0.35);
    g.add(claw);
  }
  // …and the pack mark on the left: a moon CRESCENT, cut as a lit disc with a
  // dark disc bitten out of it. Five loose pinhead spheres just read as
  // scattered dots, not a mark anybody put there.
  const moon = new Mesh(new SphereGeometry(0.042, 18, 14), glowMat(accent, 1.1));
  moon.scale.set(1, 1, 0.16);
  moon.position.set(-0.098, 0.03, -0.176);
  g.add(moon);
  // The bite is cut in the PLATE's own steel, not in black — as a dark disc
  // it lit up as a glossy 8-ball sitting on the chest instead of reading as
  // the missing part of a moon.
  // Flattened hard: any curvature left on it catches its own specular and the
  // "missing" half starts reading as a second disc laid over the moon.
  const bite = new Mesh(new SphereGeometry(0.038, 18, 14), chassisMat(accent, 0.02));
  bite.scale.set(1, 1, 0.05);
  bite.position.set(-0.126, 0.036, -0.18);
  g.add(bite);

  // Chevron abs with glow seams, hard flanks — the shared sharp underbody.
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

/** WOLF hips: a hunter's belt with a fur KILT — staggered dark pelt plates —
 *  and a glowing clasp. */
function buildWolfPelvis(accent: number): Group {
  const g = taggedHead('wolf');
  const belt = new Mesh(new BoxGeometry(0.19, 0.05, 0.15), chassisMat(accent, 0.04));
  belt.position.y = 0.05;
  g.add(belt);
  const clasp = new Mesh(new SphereGeometry(0.024, 10, 8), glowMat(accent, 1.1));
  clasp.scale.set(1, 0.8, 0.5);
  clasp.position.set(0, 0.05, -0.08);
  g.add(clasp);
  for (let i = 0; i < 5; i++) {
    const a = ((-60 + i * 30) * Math.PI) / 180;
    const plate = new Mesh(new BoxGeometry(0.055, 0.16 - Math.abs(i - 2) * 0.015, 0.028), darkMat());
    plate.position.set(Math.sin(a) * 0.11, -0.05, -Math.cos(a) * 0.09);
    plate.rotation.set(0.1, a, Math.sin(a) * 0.25);
    g.add(plate);
  }
  return g;
}

/** FROG (LEGS) → lofted for accuracy: the pond heavyweight — a broad FLAT
 *  head wider than it is long, big dome eye-turrets perched ON TOP (the frog
 *  signature), a wide smile line wrapping the snout, a throat sac tucked
 *  under the jaw, and two pin nostrils up top. Smooth and gel-glossy — no
 *  fur, no plates. */
function buildFrogHead(accent: number): Group {
  const r = BODY_IK.headRadius;
  const g = taggedHead('frog');
  g.scale.set(2.03, 1.51, 1.78); // wide and low, and HUGE — the flat pond profile fills the guard
  g.position.y = 0.0;

  // The skull loft: low flat crown, widest at the cheeks, then a broad round
  // snout sloping to the lip — no stop, no muzzle, just one smooth wedge.
  const skull = new Mesh(
    loftGeometry(
      [
        { top: [0.28, 0.5], bot: [-0.3, 0.52], w: 0.5, n: 2.2 }, // back of skull
        { top: [0.42, 0.2], bot: [-0.42, 0.3], w: 0.62, n: 2.3 }, // crown (flat, wide)
        { top: [0.4, -0.12], bot: [-0.48, 0.02], w: 0.66, n: 2.3 }, // cheeks (widest)
        { top: [0.3, -0.42], bot: [-0.46, -0.3], w: 0.58, n: 2.2 }, // eye line
        { top: [0.14, -0.7], bot: [-0.4, -0.6], w: 0.46, n: 2.1 }, // snout
        { top: [0.02, -0.92], bot: [-0.3, -0.86], w: 0.3, n: 2.0 }, // lip
        { top: [-0.04, -1.0], bot: [-0.22, -0.98], w: 0.16, n: 1.9 }, // tip (rounded)
      ],
      r,
    ),
    chassisMat(accent, 0.06),
  );
  g.add(skull);

  // The eye turrets: big domes on TOP of the skull, each a dark socket cup
  // with a glowing lens set INTO it and a slit pupil sunk in the glass.
  //
  // The lens used to be a bare glow ball with the pupil floating as a bar in
  // front of it — two headlights with a slot across them, which is where the
  // "toy" read came from. Ringing the lens in dark and sinking the slit gives
  // it somewhere to sit.
  for (const side of [-1, 1]) {
    const dome = new Mesh(new SphereGeometry(r * 0.27, 16, 12), chassisMat(accent, 0.05));
    dome.position.set(side * r * 0.38, r * 0.5, -r * 0.32);
    g.add(dome);
    const socket = new Mesh(new SphereGeometry(r * 0.21, 16, 12), darkMat());
    socket.scale.set(1, 1, 0.9);
    socket.position.set(side * r * 0.38, r * 0.52, -r * 0.4);
    g.add(socket);
    const lens = new Mesh(new SphereGeometry(r * 0.165, 14, 12), glowMat(accent, 1.7));
    lens.position.set(side * r * 0.38, r * 0.53, -r * 0.46);
    g.add(lens);
    // The slit, sunk into the lens rather than hovering off it.
    // Sat at -0.56 this was swallowed INSIDE the lens sphere (whose front face
    // is out at -0.625) and the eye read blank. Bring it to the glass.
    const pupil = new Mesh(new BoxGeometry(r * 0.2, r * 0.055, r * 0.05), darkMat());
    pupil.position.set(side * r * 0.38, r * 0.53, -r * 0.61);
    g.add(pupil);
    // (No brow shelf over the turret — a frog has no brow, and the bar sitting
    // on top of each dome read as an eyebrow glued on rather than anatomy.)
    // TYMPANUM: the big round eardrum disc behind each eye. No frog reads as
    // a frog without them, and this head had nothing at all on its cheeks.
    const drum = new Mesh(new SphereGeometry(r * 0.14, 14, 12), darkMat());
    drum.scale.set(0.5, 1, 1);
    drum.position.set(side * r * 0.62, r * 0.12, -r * 0.12);
    g.add(drum);
    const drumRing = new Mesh(new SphereGeometry(r * 0.155, 14, 12), glowMat(accent, 0.3));
    drumRing.scale.set(0.42, 1, 1);
    drumRing.position.set(side * r * 0.6, r * 0.12, -r * 0.12);
    g.add(drumRing);
  }

  // The smile: ONE continuous line wrapping the snout, built from overlapping
  // segments that meet. As three separate bars with gaps at the joins it read
  // as scratches under the nose rather than a mouth.
  const smileMid = new Mesh(new BoxGeometry(r * 0.66, r * 0.04, r * 0.035), darkMat());
  smileMid.position.set(0, -r * 0.22, -r * 0.89);
  g.add(smileMid);
  for (const side of [-1, 1]) {
    // Hugging the snout's curve — any longer/straighter and the ends poked
    // past the cheeks like whiskers.
    const corner = new Mesh(new BoxGeometry(r * 0.42, r * 0.04, r * 0.035), darkMat());
    corner.position.set(side * r * 0.36, -r * 0.185, -r * 0.74);
    corner.rotation.set(0, side * 0.72, side * 0.14);
    g.add(corner);
  }

  // The throat sac, tucked under the jaw — a warmer sheen than the shell so
  // it reads soft; and two pin nostrils high on the snout.
  const sac = new Mesh(new SphereGeometry(r * 0.3, 16, 12), chassisMat(accent, 0.1));
  sac.scale.set(1.25, 0.7, 0.95);
  sac.position.set(0, -r * 0.44, -r * 0.5);
  g.add(sac);
  // A lit seam where the sac meets the jaw, so it reads as part of the head
  // instead of a second blob parked underneath it.
  const sacSeam = new Mesh(new SphereGeometry(r * 0.31, 16, 8, 0, Math.PI * 2, Math.PI * 0.32, 0.12), glowMat(accent, 0.28));
  sacSeam.scale.set(1.25, 0.7, 0.95);
  sacSeam.position.copy(sac.position);
  g.add(sacSeam);
  for (const side of [-1, 1]) {
    const nostril = new Mesh(new SphereGeometry(r * 0.035, 8, 6), darkMat());
    nostril.position.set(side * r * 0.1, r * 0.12, -r * 0.9);
    g.add(nostril);
  }
  return g;
}

/** FROG chest: the stallion's plated cuirass gone amphibian — collar and
 *  broad flat shoulder pads over a dark trunk, a BANDED pale belly stacked
 *  down the front (eagle-style breast plates, wider), a lily-pad medallion
 *  at the sternum and dark pond spots on the pads and flanks. */
function buildFrogChest(accent: number): Group {
  const g = taggedHead('frog');
  const collar = new Mesh(new BoxGeometry(0.4, 0.08, 0.19), chassisMat(accent, 0.05));
  collar.position.y = 0.11;
  g.add(collar);

  // BULBOUS dome shoulders, the knight's pauldron construction gone pond:
  // a half-dome shell tilted over the arm with a dark under-fill so it never
  // reads hollow and a rim lip at the cut edge — kept COMPLETELY smooth (no
  // studs, no lames, no crown spots — the domes read best bare).
  for (const side of [-1, 1]) {
    const sh = new Group();
    sh.position.set(side * 0.27, 0.11, 0);
    sh.rotation.z = side * -0.22;
    g.add(sh);
    const dome = new Mesh(
      new SphereGeometry(0.145, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6),
      chassisMat(accent, 0.05),
    );
    dome.scale.set(1, 0.82, 1.05);
    sh.add(dome);
    const fill = new Mesh(new SphereGeometry(0.12, 12, 9), darkMat());
    fill.scale.set(1, 0.62, 1.0);
    fill.position.y = -0.02;
    sh.add(fill);
    const lip = new Mesh(new CylinderGeometry(0.143, 0.148, 0.026, 18), glowMat(accent, 0.45));
    lip.scale.z = 1.05;
    lip.position.y = -0.036;
    sh.add(lip);
  }

  const trunk = new Mesh(new CylinderGeometry(0.155, 0.085, 0.42, 8), darkMat());
  trunk.scale.z = 0.74;
  trunk.position.y = -0.13;
  g.add(trunk);

  // The banded belly: four wide plates stepping down the front, each with a
  // pale glow seam — the frog's segmented underbelly in armour language.
  for (let i = 0; i < 4; i++) {
    const w = 0.24 - i * 0.035;
    const band = new Mesh(new BoxGeometry(w, 0.07, 0.06), chassisMat(accent, 0.06));
    band.position.set(0, 0.02 - i * 0.078, -0.125 - i * 0.002);
    band.rotation.x = -0.14;
    g.add(band);
    const seam = new Mesh(new BoxGeometry(w * 0.9, 0.011, 0.062), glowMat(accent, 0.4));
    seam.position.set(0, -0.015 - i * 0.078, -0.125 - i * 0.002);
    g.add(seam);
  }
  // The lily-pad medallion at the sternum, stallion-style but flat and wide.
  const pod = new Mesh(new CylinderGeometry(0.042, 0.042, 0.024, 12), glowMat(accent, 1.3));
  pod.rotation.x = Math.PI / 2;
  pod.position.set(0, 0.06, -0.155);
  g.add(pod);

  // Hard flanks with a pond spot low on each.
  for (const side of [-1, 1]) {
    const flank = new Mesh(new BoxGeometry(0.045, 0.26, 0.2), chassisMat(accent, 0.04));
    flank.position.set(side * 0.14, -0.08, 0);
    flank.rotation.z = side * 0.13;
    g.add(flank);
    const spot = new Mesh(new SphereGeometry(0.024, 10, 8), darkMat());
    spot.scale.set(0.35, 1, 1);
    spot.position.set(side * 0.165, -0.12, 0.02);
    g.add(spot);
  }
  return g;
}

/** FROG hips: the panther set gone pond — belt, lily clasp, tapered guard
 *  and wide flat tassets with glow edges (plates, not haunches). */
function buildFrogPelvis(accent: number): Group {
  const g = taggedHead('frog');
  const belt = new Mesh(new BoxGeometry(0.2, 0.05, 0.16), chassisMat(accent, 0.04));
  belt.position.y = 0.05;
  g.add(belt);
  const clasp = new Mesh(new CylinderGeometry(0.026, 0.026, 0.028, 12), glowMat(accent, 1.1));
  clasp.rotation.x = Math.PI / 2;
  clasp.position.set(0, 0.05, -0.085);
  g.add(clasp);
  const guard = new Mesh(new CylinderGeometry(0.08, 0.03, 0.14, 6), chassisMat(accent, 0.03));
  guard.position.set(0, -0.05, -0.02);
  g.add(guard);
  for (const side of [-1, 1]) {
    const tasset = new Mesh(new BoxGeometry(0.065, 0.16, 0.13), chassisMat(accent, 0.04));
    tasset.position.set(side * 0.1, -0.05, 0);
    tasset.rotation.z = side * 0.26;
    g.add(tasset);
    const edge = new Mesh(new BoxGeometry(0.07, 0.013, 0.135), glowMat(accent, 0.4));
    edge.position.set(side * 0.115, -0.12, 0);
    edge.rotation.z = side * 0.26;
    g.add(edge);
  }
  return g;
}

/** OSWALD — the lucky rabbit, cast in iron. A HUGE round skull (the biggest
 *  head on the roster), the white MUZZLE MASK that gives Oswald his face, big
 *  close-set oval eyes with dark pupils, a round button nose, and the neon
 *  BUCK TEETH we keep from the old bunny. The signature is the EARS: two tall
 *  STAND-UP blades off the crown that lean out, break back once at the hinge
 *  and again near the tip — stood proud like Bugs, still soft enough to read
 *  floppy. Each ear is one pivot chain (root → hinge → tip) so it moves as a
 *  single limb, never separate parts.
 *
 *  The skin id stays 'bunny': it's the save key for owned/worn prefs and the
 *  per-skin geometry tag, so only the display name changed. */
function buildOswaldHead(accent: number): Group {
  const r = BODY_IK.headRadius;
  const g = taggedHead('bunny');
  g.scale.setScalar(1.58); // the biggest head on the roster — that's the joke
  g.position.y = 0.04;

  // The skull loft: one big rounded dome — Oswald is drawn from circles, so
  // the cheeks stay nearly as wide as the crown and the muzzle is barely a
  // muzzle at all, just a short rounded push forward.
  const skull = new Mesh(
    loftGeometry(
      [
        { top: [0.32, 0.62], bot: [-0.5, 0.54], w: 0.42, n: 2.1 }, // occiput
        { top: [0.72, 0.28], bot: [-0.62, 0.38], w: 0.54, n: 2.15 }, // crown — tall and round
        { top: [0.7, -0.08], bot: [-0.67, 0.14], w: 0.57, n: 2.15 }, // brow (widest)
        { top: [0.46, -0.4], bot: [-0.62, -0.18], w: 0.51, n: 2.1 }, // cheeks
        { top: [0.18, -0.62], bot: [-0.48, -0.46], w: 0.34, n: 2.0 }, // muzzle root
        { top: [0.02, -0.76], bot: [-0.34, -0.68], w: 0.22, n: 1.9 }, // blunt nose end
      ],
      r,
    ),
    chassisMat(accent, 0.06),
  );
  g.add(skull);

  // THE EARS — tall, standing, with two soft breaks backward.
  for (const side of [-1, 1]) {
    const ear = new Group();
    // Pivot buried INSIDE the dome (0.24r in, 0.52r up) with the root run
    // long past it — pivoted at crown height the base hovers visibly clear of
    // the skull and the ears read as detached.
    ear.position.set(side * r * 0.24, r * 0.52, r * 0.1);
    ear.rotation.set(-0.05, 0, side * -0.17); // stands tall, leaning out a hair
    g.add(ear);
    const root = new Mesh(new CylinderGeometry(r * 0.15, r * 0.2, r * 0.46, 12), chassisMat(accent, 0.05));
    root.scale.z = 0.55; // flattened front-to-back — an ear, not a horn
    root.position.y = r * 0.14;
    ear.add(root);

    // The hinge: everything above sweeps BACK a touch (+X rotation is back).
    const hinge = new Group();
    hinge.position.y = r * 0.36;
    hinge.rotation.set(0.22, 0, side * -0.1);
    ear.add(hinge);
    const blade = new Mesh(new CylinderGeometry(r * 0.12, r * 0.16, r * 0.58, 12), chassisMat(accent, 0.05));
    blade.scale.z = 0.5;
    blade.position.y = r * 0.28;
    hinge.add(blade);

    // The floppy break near the tip — what keeps a standing ear from reading
    // as a rigid spike.
    const tipJoint = new Group();
    tipJoint.position.y = r * 0.56;
    tipJoint.rotation.x = 0.38;
    hinge.add(tipJoint);
    const tipBlade = new Mesh(new CylinderGeometry(r * 0.085, r * 0.12, r * 0.28, 12), chassisMat(accent, 0.05));
    tipBlade.scale.z = 0.5;
    tipBlade.position.y = r * 0.13;
    tipJoint.add(tipBlade);
    const cap = new Mesh(new SphereGeometry(r * 0.085, 12, 10), chassisMat(accent, 0.05));
    cap.scale.set(1.0, 1.15, 0.5);
    cap.position.y = r * 0.26;
    tipJoint.add(cap);

    // The pale inner channel, turned FORWARD (-Z) and split at the tip break
    // so it follows the bend instead of shearing through it.
    const innerLo = new Mesh(new BoxGeometry(r * 0.15, r * 0.54, r * 0.02), glowMat(accent, 0.16));
    innerLo.position.set(0, r * 0.28, -r * 0.075);
    hinge.add(innerLo);
    const innerHi = new Mesh(new BoxGeometry(r * 0.1, r * 0.26, r * 0.02), glowMat(accent, 0.16));
    innerHi.position.set(0, r * 0.13, -r * 0.055);
    tipJoint.add(innerHi);
  }

  // THE MASK — Oswald's face is a white muzzle mound on a black head, and
  // that two-tone read is most of the likeness. A wide squashed dome sitting
  // proud of the skull, in the accent so it repaints with the rest of the
  // suit; the cheek puffs flank it in the same tone.
  const mask = new Mesh(new SphereGeometry(r * 0.31, 18, 14), glowMat(accent, 0.2));
  mask.scale.set(1.5, 1.05, 1.0);
  mask.position.set(0, -r * 0.3, -r * 0.5);
  g.add(mask);
  for (const side of [-1, 1]) {
    const puff = new Mesh(new SphereGeometry(r * 0.17, 12, 10), glowMat(accent, 0.2));
    puff.scale.set(1.0, 0.85, 0.8);
    puff.position.set(side * r * 0.28, -r * 0.26, -r * 0.46);
    g.add(puff);
  }

  // The eyes: big CLOSE-SET ovals — white sclera, dark pupil, ringed dark so
  // they pop off the black skull the way ink outlines do.
  for (const side of [-1, 1]) {
    const ring = new Mesh(new SphereGeometry(r * 0.185, 16, 14), darkMat());
    ring.scale.set(0.82, 1.15, 0.4);
    ring.position.set(side * r * 0.17, r * 0.18, -r * 0.5);
    g.add(ring);
    const sclera = new Mesh(new SphereGeometry(r * 0.155, 16, 14), glowMat(accent, 0.85));
    sclera.scale.set(0.82, 1.15, 0.42);
    sclera.position.set(side * r * 0.17, r * 0.18, -r * 0.54);
    g.add(sclera);
    const pupil = new Mesh(new SphereGeometry(r * 0.075, 14, 12), darkMat());
    pupil.scale.set(0.9, 1.2, 0.4);
    pupil.position.set(side * r * 0.19, r * 0.16, -r * 0.6);
    g.add(pupil);
  }

  // Muzzle furniture: the round button nose, the philtrum, and the BUCK TEETH
  // — two NEON plates dropping from the mouth line, kept from the old bunny.
  const nose = new Mesh(new SphereGeometry(r * 0.1, 12, 10), darkMat());
  nose.scale.set(1.1, 0.95, 0.85);
  nose.position.set(0, -r * 0.12, -r * 0.78);
  g.add(nose);
  const philtrum = new Mesh(new BoxGeometry(r * 0.028, r * 0.13, r * 0.03), darkMat());
  philtrum.position.set(0, -r * 0.26, -r * 0.82);
  philtrum.rotation.x = 0.15;
  g.add(philtrum);
  // The teeth hang from the mouth line and OVER the lip — they have to clear
  // the mask ellipsoid in both z and y or the muzzle simply eats them, which
  // is what the first pass did.
  for (const side of [-1, 1]) {
    const tooth = new Mesh(new BoxGeometry(r * 0.09, r * 0.2, r * 0.05), glowMat(accent, 2.2));
    tooth.position.set(side * r * 0.05, -r * 0.6, -r * 0.7);
    tooth.rotation.x = 0.1;
    g.add(tooth);
  }
  return g;
}

/** OSWALD's chest: soft armour over a slugger's frame — rounded shoulder pads
 *  with a glow lip, a pale BIB fanned across the upper chest (the white front
 *  under a black rabbit's chin), a slim dark trunk with belly bands and glow
 *  seams. */
function buildOswaldChest(accent: number): Group {
  const g = taggedHead('bunny');
  const collar = new Mesh(new BoxGeometry(0.4, 0.08, 0.19), chassisMat(accent, 0.05));
  collar.position.y = 0.11;
  g.add(collar);

  for (const side of [-1, 1]) {
    const pad = new Mesh(new SphereGeometry(0.1, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), chassisMat(accent, 0.05));
    pad.scale.set(1, 0.7, 1);
    pad.position.set(side * 0.27, 0.09, 0);
    pad.rotation.z = side * -0.2;
    g.add(pad);
    const lip = new Mesh(new CylinderGeometry(0.097, 0.102, 0.018, 16), glowMat(accent, 0.5));
    lip.position.set(side * 0.27, 0.068, 0);
    lip.rotation.z = side * -0.2;
    g.add(lip);
  }

  // The bib: five soft plates fanned across the upper chest. Left in the
  // chassis steel — Oswald's body is black, and painting these the accent
  // gave him a white apron that fought the face for attention.
  for (let i = -2; i <= 2; i++) {
    const bib = new Mesh(new BoxGeometry(0.085, 0.16 - Math.abs(i) * 0.02, 0.03), chassisMat(accent, 0.04));
    bib.position.set(i * 0.065, -0.02 - Math.abs(i) * 0.025, -0.135);
    bib.rotation.set(0.12, 0, i * 0.18);
    g.add(bib);
  }

  const trunk = new Mesh(new CylinderGeometry(0.15, 0.08, 0.42, 8), darkMat());
  trunk.scale.z = 0.7;
  trunk.position.y = -0.13;
  g.add(trunk);

  // Belly bands with glow seams — the shared underbody, rounded corners.
  for (let i = 0; i < 3; i++) {
    const w = 0.17 - i * 0.03;
    const band = new Mesh(new BoxGeometry(w, 0.05, 0.07), chassisMat(accent, 0.04));
    band.position.set(0, -0.16 - i * 0.07, -0.1);
    band.rotation.x = -0.1;
    g.add(band);
    const seam = new Mesh(new BoxGeometry(w * 0.88, 0.009, 0.072), glowMat(accent, 0.3));
    seam.position.set(0, -0.187 - i * 0.07, -0.1);
    g.add(seam);
  }
  for (const side of [-1, 1]) {
    const flank = new Mesh(new BoxGeometry(0.045, 0.25, 0.19), chassisMat(accent, 0.04));
    flank.position.set(side * 0.14, -0.08, 0);
    flank.rotation.z = side * 0.12;
    g.add(flank);
  }
  return g;
}

/** OSWALD's hips: a soft belt, wide sprung tassets over the powerhouse
 *  haunches — and the PUFF TAIL riding the back of the belt. */
function buildOswaldPelvis(accent: number): Group {
  const g = taggedHead('bunny');
  const belt = new Mesh(new BoxGeometry(0.19, 0.05, 0.15), chassisMat(accent, 0.04));
  belt.position.y = 0.05;
  g.add(belt);
  const clasp = new Mesh(new SphereGeometry(0.024, 10, 8), glowMat(accent, 1.0));
  clasp.scale.set(1, 0.8, 0.5);
  clasp.position.set(0, 0.05, -0.08);
  g.add(clasp);
  // The puff tail — nobody ships a rabbit without one, and Oswald's is the
  // one white spot on his back, so it takes the accent.
  const tail = new Mesh(new SphereGeometry(0.055, 12, 10), glowMat(accent, 0.2));
  tail.position.set(0, 0.0, 0.1);
  g.add(tail);
  for (const side of [-1, 1]) {
    const tasset = new Mesh(new BoxGeometry(0.085, 0.15, 0.12), chassisMat(accent, 0.04));
    tasset.position.set(side * 0.11, -0.1, 0);
    tasset.rotation.z = side * 0.3;
    g.add(tasset);
    const edge = new Mesh(new BoxGeometry(0.087, 0.013, 0.125), glowMat(accent, 0.4));
    edge.position.set(side * 0.11, -0.155, 0);
    edge.rotation.z = side * 0.3;
    g.add(edge);
  }
  return g;
}

/** Per-skin builders, keyed by skin id — pick one (a fixed wearer) or all
 *  of them (the customisation mirror, which toggles between them live). */
const HEAD_BUILDERS: Record<string, (accent: number) => Group> = {
  cobalt: buildBearHead,
  crimson: buildPantherHead,
  valkyrie: buildEagleHead,
  knight: buildKnightHead,
  stallion: buildStallionHead,
  wolf: buildWolfHead,
  frog: buildFrogHead,
  bunny: buildOswaldHead,
};
const CHEST_BUILDERS: Record<string, (accent: number) => Group> = {
  cobalt: buildBearChest,
  crimson: buildPantherChest,
  valkyrie: buildEagleChest,
  knight: buildKnightChest,
  stallion: buildStallionChest,
  wolf: buildWolfChest,
  frog: buildFrogChest,
  bunny: buildOswaldChest,
};
const PELVIS_BUILDERS: Record<string, (accent: number) => Group> = {
  cobalt: buildBearPelvis,
  crimson: buildPantherPelvis,
  valkyrie: buildEaglePelvis,
  knight: buildKnightPelvis,
  stallion: buildStallionPelvis,
  wolf: buildWolfPelvis,
  frog: buildFrogPelvis,
  bunny: buildOswaldPelvis,
};
const ALL_SKIN_IDS = ['cobalt', 'crimson', 'valkyrie', 'knight', 'stallion', 'wolf', 'frog', 'bunny'];

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

  // Each skin part is rigid after build (only the hands articulate), so bake
  // its dozens of plates down to one mesh per material look — the KNIGHT set
  // alone was ~75 draw calls per bot, and three FFA bots rolling the heavy
  // skins was a visible frame hit. The tagged group survives the collapse, so
  // applyAvatarSkin's show-one-skin toggle and the accent/role recolours all
  // work unchanged.
  const buildCollapsed = (builder: (accent: number) => Group): Group => {
    const g = builder(accent);
    collapseStatic(g);
    if (sole) g.visible = true;
    return g;
  };

  // --- Head: a detailed metallic ANIMAL head per built skin (front is −z).
  //     Hitboxes are the BODY_IK spheres and never change, so every fighter is
  //     equally hittable whatever's built. ---
  const head = new Group();
  head.name = 'opponent-head';
  for (const id of ids) head.add(buildCollapsed(HEAD_BUILDERS[id]));

  // --- Torso: a DISTINCT armoured cuirass + hip set per built skin. Same
  //     silhouette envelope and BODY_IK hitbox spheres, equally hittable. ---
  const chest = new Group();
  chest.name = 'opponent-chest';
  for (const id of ids) chest.add(buildCollapsed(CHEST_BUILDERS[id]));

  const pelvis = new Group();
  pelvis.name = 'opponent-pelvis';
  for (const id of ids) pelvis.add(buildCollapsed(PELVIS_BUILDERS[id]));

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
