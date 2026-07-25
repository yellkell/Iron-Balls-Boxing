/**
 * Attack telegraphs for the ARCADE titans — the whole "souls-like" readability
 * contract lives here. Every titan strike marks its kill zone ON THE PLAYER'S
 * PLATFORM while it charges: hazard-amber shapes that fill up and shift to
 * danger-red as the strike arrives (the fill IS the countdown). Three shapes:
 *
 *  - CIRCLE  : a fist slam / mortar shell footprint — step out of the disc.
 *  - BEAM    : a strip the eye-beam will rake — sidestep off the line.
 *  - SWEEP   : a horizontal blade slice across the platform at a marked
 *              height — duck under it (a floor band shows it's coming).
 *
 * All shader-driven planes; cheap, additive, no textures.
 */

import {
  AdditiveBlending,
  DoubleSide,
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import { CAMPAIGN } from '../config.js';

export interface Telegraph {
  /** Position/rotate this; the shapes live inside. */
  group: Group;
  /** fill: 0..1 charge progress; time: seconds for the pulse. */
  update(fill: number, time: number): void;
  dispose(): void;
}

/** Shared vertex shader — pass UVs through. */
const VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/**
 * Shared drawing helpers — no uniforms of their own, so any telegraph shader
 * can pull them in regardless of what it declares.
 */
const AA = /* glsl */ `
  /**
   * These planes blend ADDITIVELY, so the alpha channel is really a brightness
   * multiplier on the warning colour — and the layers below stack by +=. Where
   * two features overlapped (the rim and its ticks, the centre dot and the
   * charge disc) the sum ran past 1 and the amber/red blew out to flat white,
   * which is what made a charging telegraph read as a bright smear instead of
   * a shape. Cap it, and the warning keeps its colour wherever layers meet.
   */
  float ink(float a){ return clamp(a, 0.0, 1.0); }

  /**
   * A soft step whose edge is one pixel wide on screen, whatever the angle.
   * Deck telegraphs are viewed at very grazing angles in VR, where a hard
   * step() on a repeating pattern crawls and moirés badly.
   */
  float aaStep(float edge, float x){
    float w = max(fwidth(x), 1e-5);
    return smoothstep(edge - w, edge + w, x);
  }

  /**
   * A repeating stripe: ~1 where fract(x) is past 'duty', antialiased at both
   * ends of the pulse. Once a whole tile is smaller than a pixel the pattern
   * dissolves to its own average rather than aliasing into noise.
   * (No backticks in here — these blocks are JS template literals.)
   */
  float aaStripe(float x, float duty){
    float w = max(fwidth(x), 1e-5);
    float f = fract(x);
    float sharp = smoothstep(duty - w, duty + w, f) - smoothstep(1.0 - w, 1.0, f);
    return mix(sharp, 1.0 - duty, smoothstep(0.25, 0.5, w));
  }

  /** A ring/band between two soft edges: rises over a→b, falls over c→d. */
  float band(float x, float a, float b, float c, float d){
    return smoothstep(a, b, x) * (1.0 - smoothstep(c, d, x));
  }
`;

/** Hazard amber → danger red as the charge completes, pulsing faster. */
const COMMON = /* glsl */ `
  uniform float uFill, uTime;
  varying vec2 vUv;
  ${AA}
  vec3 warnColor(){
    return mix(vec3(1.0, 0.69, 0.0), vec3(0.91, 0.21, 0.16), smoothstep(0.55, 0.95, uFill));
  }
  float pulse(){
    float rate = mix(3.0, 14.0, uFill);
    return 0.82 + 0.18 * sin(uTime * rate);
  }
`;

/** Disc: bold rim ring, hazard ticks, a hot centre dot, and a radial fill
 *  that eats outward — LOUD, because this marks where a fist lands. */
const CIRCLE_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    vec3 col = warnColor();
    float a = 0.0;
    // Rim ring.
    a += band(r, 0.84, 0.9, 0.97, 1.0);
    // Rotating hazard ticks just inside the rim. Antialiased: these are
    // ANGULAR stripes, so they crowd together as the disc tilts away and used
    // to break into crawling speckle right where the eye follows the rim.
    float ang = atan(p.y, p.x) + uTime * 1.2;
    a += aaStripe(ang * 3.8195, 0.5) * band(r, 0.72, 0.78, 0.82, 0.84) * 0.6;
    // Hot centre dot — the exact impact point.
    a += (1.0 - smoothstep(0.05, 0.14, r)) * 0.9;
    // Charge disc growing outward from the centre — solid enough to read
    // against a bright passthrough room.
    a += (1.0 - smoothstep(uFill * 0.85, uFill * 0.9 + 0.004, r)) * 0.6;
    a *= pulse();
    // No discard for the square plane's corners: every term above is already
    // zero past r = 1, and discard costs a tile-based mobile GPU its early-Z
    // for the whole draw.
    gl_FragColor = vec4(col, ink(a));
  }
`;

/** Strip: edge rails + a fill front that advances down the line (v: 1 → 0). */
const STRIP_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    vec3 col = warnColor();
    float a = 0.0;
    // Side rails.
    float edge = min(vUv.x, 1.0 - vUv.x);
    a += (1.0 - smoothstep(0.04, 0.1, edge)) * 0.9;
    // Chevron dashes marching toward the player while it charges. A beam
    // strip runs AWAY from you down the deck, so its far end is the most
    // foreshortened thing on screen — exactly where a hard-stepped dash
    // pattern turns to shimmer.
    a += aaStripe(vUv.y * 9.0 + uTime * 2.2, 0.5) * 0.18;
    // The advance front: fills from the far (titan) end toward you.
    a += aaStep(1.0 - uFill, vUv.y) * 0.34;
    a *= pulse();
    gl_FragColor = vec4(col, ink(a));
  }
`;

/**
 * Nova: the whole disc floods with warning EXCEPT one safe wedge, whose
 * edges are drawn as two bright rays — the one telegraph that means
 * "stand HERE". uAngle = wedge centre (radians), uHalf = wedge half-width.
 */
const NOVA_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uAngle, uHalf;
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    // World-space angle: the plane is rotated flat, so uv v runs down −z.
    float ang = atan(p.x, -p.y);
    float d = abs(mod(ang - uAngle + 3.14159, 6.28318) - 3.14159);
    // Softened: this is the boundary of the ONE piece of safe ground on the
    // deck, and a hard step() left it a jagged staircase you had to guess at.
    float inWedge = 1.0 - aaStep(uHalf, d);
    vec3 col = warnColor();
    float a = 0.0;
    // The flood: everything OUTSIDE the wedge fills and pulses.
    a += (1.0 - inWedge) * (0.16 + 0.5 * uFill);
    // Rim ring all the way round, dimmer through the wedge.
    a += band(r, 0.9, 0.95, 0.98, 1.0) * (1.0 - inWedge * 0.7);
    // The wedge's edge rays — the doorposts of the safe ground.
    a += smoothstep(0.06, 0.0, abs(d - uHalf)) * 0.9;
    a *= pulse();
    // Cut the square plane to a disc with a soft edge. The flood term has no
    // r in it, so this replaces the old discard — and antialiases the nova's
    // outline, which used to be a hard jagged circle.
    a *= 1.0 - smoothstep(0.985, 1.0, r);
    gl_FragColor = vec4(col, ink(a));
  }
`;

/**
 * Half-platform flood (GOOPLIATH's seesaw): one side of the deck fills with
 * warning while a hard rail burns along the centreline — the honest border —
 * and chevrons march toward the SAFE half: jump. uDir is the local-x
 * direction of escape (−side), so the arrows always point off the doomed half.
 */
const HALF_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    vec3 col = warnColor();
    float a = 0.0;
    // The flood: the whole half fills as the wave charges. Only TWO panes
    // ever show at once (the imminent beat and the one after — see
    // advanceAttack), so the ramp is bold: the side about to blow is
    // unmistakably the bright one, its follow-up a faint promise.
    a += 0.05 + 0.55 * uFill;
    // The centreline rail — the honest border you must be across. The mesh is
    // authored with u = 0 on the centreline, u = 1 at the outer rim.
    a += (1.0 - smoothstep(0.0, 0.06, vUv.x)) * (0.25 + 0.75 * uFill);
    // Bands marching toward the centreline — CROSS HERE, the other half lives.
    float lanes = aaStripe(vUv.x * 5.0 + uTime * 2.4, 0.72);
    float rungs = 1.0 - aaStep(0.32, abs(fract(vUv.y * 3.0) - 0.5));
    a += lanes * rungs * (0.1 + 0.25 * uFill);
    a *= pulse();
    gl_FragColor = vec4(col, ink(a));
  }
`;

/**
 * GO zone (the tutorial's footwork cue) — the inverse of the half flood:
 * the called half of the deck GLOWS GREEN ("stand HERE"), bands march INTO
 * it, and the centreline rail is the line to cross. Same fill contract as
 * every warning: 0→1 as the incoming ball flies, so urgency reads exactly
 * like a boss telegraph, just inverted from "flee" to "come".
 */
const GO_FRAG = /* glsl */ `
  uniform float uFill, uTime;
  varying vec2 vUv;
  ${AA}
  void main(){
    vec3 col = vec3(0.34, 0.88, 0.54);
    float a = 0.0;
    // Welcoming flood, brightening as the ball closes.
    a += 0.08 + 0.4 * uFill;
    // The centreline rail — the honest border to get across (u = 0 there).
    a += (1.0 - smoothstep(0.0, 0.06, vUv.x)) * (0.3 + 0.7 * uFill);
    // Bands marching INTO the safe half — follow them.
    float lanes = aaStripe(vUv.x * 5.0 - uTime * 2.4, 0.72);
    float rungs = 1.0 - aaStep(0.32, abs(fract(vUv.y * 3.0) - 0.5));
    a += lanes * rungs * (0.12 + 0.25 * uFill);
    // A soft glow at the outer rim, so the zone reads as a destination.
    a += smoothstep(0.92, 1.0, vUv.x) * 0.25;
    a *= 0.85 + 0.15 * sin(uTime * mix(2.5, 10.0, uFill));
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  }
`;

/**
 * Blade: a horizontal slice hanging in the air — bright core line, soft body.
 *
 * uDir is the direction the real blade will TRAVEL along this plane's local x:
 * +1 for left→right, −1 for right→left. It has to be told, because the strike
 * picks its side from the titan's striking arm (see spawnBladeSweep) while
 * this shader used to fill u = 0 → 1 unconditionally — so on every sweep
 * thrown with the other arm the warning wiped across one way and the blade
 * then came through the other, which is exactly the "it comes from the wrong
 * side" report. The leading edge is drawn bright and chevrons march ahead of
 * it, so the side it arrives from is legible well before the fill lands.
 */
const BLADE_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uDir;
  void main(){
    vec3 col = warnColor();
    float mid = 1.0 - abs(vUv.y * 2.0 - 1.0); // 1 at the slice centre line
    float a = pow(mid, 3.0) * 0.75 + mid * 0.12;
    // Travel coordinate: 0 is where the blade STARTS, 1 is where it ends up.
    float u = uDir < 0.0 ? 1.0 - vUv.x : vUv.x;
    // The swept-through region behind the front. Softened: a hard step drew
    // this as a ragged vertical staircase, and it's the one edge a player is
    // actually tracking.
    a *= 0.35 + 0.65 * (1.0 - aaStep(uFill, u));
    // The leading edge itself — a hot line sitting where the cut has reached.
    a += mid * (1.0 - smoothstep(0.0, 0.06, abs(u - uFill))) * 0.55;
    // Chevrons running the way the blade will come, so the direction reads
    // from the first frame rather than only once the fill is well across.
    a += aaStripe(u * 7.0 - uTime * 2.6, 0.55) * mid * 0.16;
    a *= pulse();
    gl_FragColor = vec4(col, ink(a));
  }
`;

function warnMat(frag: string, extra: Record<string, { value: number }> = {}): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uFill: { value: 0 }, uTime: { value: 0 }, ...extra },
    vertexShader: VERT,
    fragmentShader: frag,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
}

function makeTelegraph(meshes: Mesh[], mats: ShaderMaterial[]): Telegraph {
  const group = new Group();
  for (const m of meshes) {
    // Draw after the deck furniture — a warning that loses the depth fight
    // to a rim bolt is a warning nobody saw.
    m.renderOrder = 20;
    group.add(m);
  }
  return {
    group,
    update(fill, time) {
      for (const mat of mats) {
        mat.uniforms.uFill.value = fill;
        mat.uniforms.uTime.value = time;
      }
    },
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      for (const mat of mats) mat.dispose();
      group.removeFromParent();
    },
  };
}

/**
 * GOLIATH's nova: a platform-covering disc where everything floods with
 * warning EXCEPT the safe wedge centred on `angle` (world radians, atan2(x,z)
 * around the platform centre), `halfAngle` wide each side. Place the group
 * at the platform centre on the floor.
 */
export function novaTelegraph(radius: number, angle: number, halfAngle: number): Telegraph {
  const mat = warnMat(NOVA_FRAG, { uAngle: { value: angle }, uHalf: { value: halfAngle } });
  const disc = new Mesh(new PlaneGeometry(radius * 2, radius * 2), mat);
  disc.rotation.x = -Math.PI / 2;
  return makeTelegraph([disc], [mat]);
}

/**
 * GOOPLIATH's seesaw: ONE HALF of the platform floods with warning — the
 * centreline burns as a hard rail and bands march toward it: get across.
 * `side` is the doomed half's local-x sign; `halfWidth`/`depth` span the
 * platform. Place the group at the platform centre on the floor (the side
 * flip is baked in here — no extra rotation needed beyond the seat yaw).
 */
export function halfTelegraph(side: -1 | 1, halfWidth: number, depth: number): Telegraph {
  const mat = warnMat(HALF_FRAG);
  const pane = new Mesh(new PlaneGeometry(halfWidth, depth), mat);
  pane.rotation.x = -Math.PI / 2;
  // Authored for the +x half (u = 0 at the centreline); the −x half is the
  // same pane mirrored in place. The flip lives on the MESH — the group's
  // rotation stays free for the caller's seat yaw.
  pane.position.x = (side * halfWidth) / 2;
  pane.scale.x = side;
  return makeTelegraph([pane], [mat]);
}

/**
 * The green "stand HERE" half (see GO_FRAG) — used by the tutorial's
 * footwork drill. `side` is the SAFE half's local-x sign; geometry mirrors
 * halfTelegraph exactly, so it lands on the deck the same way.
 */
export function goTelegraph(side: -1 | 1, halfWidth: number, depth: number): Telegraph {
  const mat = warnMat(GO_FRAG);
  const pane = new Mesh(new PlaneGeometry(halfWidth, depth), mat);
  pane.rotation.x = -Math.PI / 2;
  pane.position.x = (side * halfWidth) / 2;
  pane.scale.x = side;
  return makeTelegraph([pane], [mat]);
}

/** A slam / mortar footprint. Place the group at the zone centre, y≈floor. */
export function circleTelegraph(radius: number): Telegraph {
  const mat = warnMat(CIRCLE_FRAG);
  const disc = new Mesh(new PlaneGeometry(radius * 2, radius * 2), mat);
  disc.rotation.x = -Math.PI / 2;
  return makeTelegraph([disc], [mat]);
}

/**
 * A beam strip `length` long and `2*halfWidth` wide, flat on the floor,
 * running along the group's local −Z (v=1 is the far end, where the fill
 * front starts). Place the group at the NEAR end centre and yaw it.
 */
export function beamTelegraph(halfWidth: number, length: number): Telegraph {
  const mat = warnMat(STRIP_FRAG);
  const strip = new Mesh(new PlaneGeometry(halfWidth * 2, length), mat);
  strip.rotation.x = -Math.PI / 2; // plane +v now points down local −Z
  strip.position.z = -length / 2;
  return makeTelegraph([strip], [mat]);
}

/**
 * A horizontal sweep slice: a glowing blade plane hanging at the strike
 * height `bladeY` (duck under it!) plus a dimmer band on the floor beneath so
 * the platform itself carries the warning. Place the group at the platform
 * centre on the floor; `width` spans the endangered lane, `depth` the floor
 * band's front-to-back reach.
 *
 * `dir` is which way the blade will actually travel along local x: +1 for
 * left→right, −1 for right→left. It MUST match spawnBladeSweep's `from` for
 * the same attack, or the warning wipes across opposite to the cut.
 */
export function sweepTelegraph(
  width: number,
  depth: number,
  bladeY: number,
  thickness: number,
  dir: 1 | -1 = 1,
): Telegraph {
  const mats: ShaderMaterial[] = [];
  const mat = (): ShaderMaterial => {
    const m = warnMat(BLADE_FRAG, { uDir: { value: dir } });
    mats.push(m);
    return m;
  };

  // The FACE: a bar hanging at the strike height across the platform's FRONT
  // edge — the one piece of this warning that lands in the player's forward
  // view, because a player being swept at is looking at the titan.
  //
  // This used to be a single vertical plane at z = 0, i.e. at the player's own
  // depth, which is a plane that CONTAINS the viewer: edge-on, zero pixels,
  // invisible. The floor band was the only other part, and when you're facing
  // a titan the deck at your feet is below your field of view — so the whole
  // sweep telegraph could not be seen at all from where it had to be read, and
  // the blade appeared to arrive out of nowhere behind you.
  const face = new Mesh(new PlaneGeometry(width, thickness * 2), mat());
  face.position.set(0, bladeY, -depth / 2);

  // The SLICE: the horizontal sheet the blade actually cuts through, at head
  // height — spells out the height you have to get under, and stays readable
  // when you turn your head to follow the cut.
  const slice = new Mesh(new PlaneGeometry(width, depth), mat());
  slice.rotation.x = -Math.PI / 2;
  slice.position.y = bladeY;

  // The FOOTPRINT on the deck, unchanged: which ground the cut covers.
  const band = new Mesh(new PlaneGeometry(width, depth), mat());
  band.rotation.x = -Math.PI / 2;
  band.position.y = CAMPAIGN.decalY;

  return makeTelegraph([face, slice, band], mats);
}
