/**
 * Builds the static arena for FIRE FIGHT, styled like a 90s UK robot-wars
 * pit: diamond-plate pedestal slabs with hazard-amber kick-bands, bolted
 * corner studs and a thin team-colour rim glow. The environment is intentionally
 * just the two platforms floating in your passthrough room:
 *  - a slab pedestal beneath YOU (ember rim) — underfoot, Blaston-style,
 *  - a matching pedestal across the gap for the opponent (blue rim),
 *  - the FIRE FIGHT title plate hung high behind the opponent (lobby only),
 *  - warm key lighting so the steel and fire read with some form.
 *
 * The guardian-style rim barrier is built and driven by BoundarySystem.
 * These are plain Three.js objects parented under `world.scene` — static
 * set-dressing. Dynamic, interactive objects become ECS entities.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  type Object3D,
} from 'three';
import type { World } from '@iwsdk/core';
import {
  ARENA_GAP,
  CHAMFER,
  EDGE_HALF,
  OCTAGON_HALF_DEPTH,
  OCTAGON_HALF_WIDTH,
  OCTAGON_VERTICES,
  PALETTE,
  PLATFORM,
  RAID_RING_RADIUS,
  teamColor,
} from '../config.js';
import { MAX_OPPONENTS } from '../combat/opponentBus.js';
import { localLayout } from '../combat/layout.js';
import { app } from '../menu/appState.js';
import { hazardTexture } from '../materials/hazard.js';
import { diamondPlateTextures, type DiamondPlateMaps } from '../materials/diamondPlate.js';
import { octagonSlab } from './octagon.js';
import { createTitleBanner } from './banner.js';

/** Shared diamond-plate maps, built lazily (both pedestals reuse them). */
let plateMaps: DiamondPlateMaps | undefined;

/**
 * Set dressing that is IDENTICAL on every pedestal — the hazard stripes and
 * the corner studs are never recoloured by a skin (applyPlatformSkin only
 * touches the 'slab'/'neon-core'/'neon-halo' roles), so one texture, one
 * material and one geometry can serve all seven pads instead of each pad
 * minting its own. hazardTexture() builds a fresh canvas + GPU upload on every
 * call, so this is the difference between one stripe texture and dozens.
 */
let hazardMat: MeshBasicMaterial | undefined;
let boltGeo: CylinderGeometry | undefined;
let boltMat: MeshStandardMaterial | undefined;

/**
 * Just proud of the slab's bevelled top face. The extrude BEVEL overhangs, so
 * the real deck surface is at +0.015, NOT y=0 — anything laid on the deck has
 * to clear that or it renders inside the steel and is never seen.
 */
const DECK_TOP = 0.02;

/**
 * The rim path: the octagon outline with every corner eased into a short arc,
 * so a tube swept along it reads as ONE piece of bent glass. Real neon IS bent
 * tubing — it has no mitred corners — which is why the rim used to give itself
 * away: eight straight bars butt-jointed at 45° leave a visible notch at every
 * vertex, and square bars leave eight of them.
 */
function rimPath(corner = 0.045): Vector3[] {
  const pts: Vector3[] = [];
  const n = OCTAGON_VERTICES.length;
  const at = (i: number): Vector3 => {
    const [x, z] = OCTAGON_VERTICES[((i % n) + n) % n];
    return new Vector3(x, PLATFORM.rimLift, z);
  };
  for (let i = 0; i < n; i++) {
    const cur = at(i);
    const prev = at(i - 1);
    const next = at(i + 1);
    // Never eat more than half of either adjoining edge.
    const r = Math.min(corner, cur.distanceTo(prev) / 2, cur.distanceTo(next) / 2);
    const a = cur.clone().lerp(prev, r / cur.distanceTo(prev)); // arc start
    const b = cur.clone().lerp(next, r / cur.distanceTo(next)); // arc end
    pts.push(a);
    // Quadratic Bézier a → cur → b: the bend itself.
    for (const t of [0.35, 0.65]) {
      const u = 1 - t;
      pts.push(
        new Vector3(
          u * u * a.x + 2 * u * t * cur.x + t * t * b.x,
          PLATFORM.rimLift,
          u * u * a.z + 2 * u * t * cur.z + t * t * b.z,
        ),
      );
    }
    pts.push(b);
  }
  return pts;
}

/** Shared rim tube geometry — every pad wears the same octagon, so the two
 *  sweeps are built once and only the MATERIALS differ per platform. */
let rimCoreGeo: TubeGeometry | undefined;
let rimHaloGeo: TubeGeometry | undefined;

/**
 * Neon rim piping: a bright white-hot core tube running the whole rim, wrapped
 * in a fatter additive halo of the team colour — proper neon tubing, not a
 * one-pixel line. Two swept meshes for the entire ring, where this used to be
 * sixteen boxes per pedestal (112 across the seven).
 */
function makeNeonRim(color: number): Group {
  const rim = new Group();
  rim.name = 'rim-ring';
  const core = new MeshBasicMaterial({
    color: new Color(color).lerp(new Color(0xffffff), 0.45),
  });
  core.userData.role = 'neon-core'; // skin recolour target (avatar/skins.ts)
  const halo = new MeshBasicMaterial({
    color: new Color(color),
    transparent: true,
    opacity: 0.4,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  halo.userData.role = 'neon-halo';
  if (!rimCoreGeo || !rimHaloGeo) {
    // 'centripetal' keeps the spline from overshooting at the bends — with the
    // default parameterisation the corners bulge outside the platform.
    const curve = new CatmullRomCurve3(rimPath(), true, 'centripetal');
    // 96 × 6 keeps the bends smooth at arm's length while trading ~15k extra
    // triangles across the seven pads for 98 fewer draw calls — the right way
    // round for a tile-based mobile GPU.
    rimCoreGeo = new TubeGeometry(curve, 96, 0.008, 6, true);
    rimHaloGeo = new TubeGeometry(curve, 96, 0.022, 6, true);
  }
  rim.add(new Mesh(rimCoreGeo, core));
  rim.add(new Mesh(rimHaloGeo, halo));
  return rim;
}

/**
 * The hazard-striped kick-band: an amber warning ring painted round the inside
 * of the rim. It belongs on a TITAN's ground, not a boxer's — on a fighter's
 * pad it just crowds the deck you stand on, but round a boss pedestal it reads
 * as the machine's own danger marking. Built on every pad and hidden by
 * default; setPlatformHazard turns it on for whichever pedestal is currently
 * carrying a boss (the raid pit always, slot 1 while a campaign titan is up).
 *
 * Built as ONE mitred ring rather than eight separate quads. Eight quads can't
 * meet cleanly at an octagon's corners — butted they leave a wedge of bare
 * steel at every vertex, overlapped they hang off the rim — so the ring is
 * offset properly instead: each corner vertex is the intersection of its two
 * inward-offset edge lines, which is a true mitre and keeps the band a constant
 * width the whole way round.
 *
 * Stripe density is baked into the UVs rather than into a per-edge
 * `texture.clone()` with its own `repeat`. That matters twice over: a clone
 * shares the image but is a separate GPU upload, so the old code pushed eight
 * copies of the same stripe texture per platform — 56 across the seven pads —
 * and `repeat` lives on the texture, so it could not follow a platform that was
 * SCALED. The raid pit is built at 2.4×, which stretched its stripes to two and
 * a half times everyone else's. UVs scale with the mesh; textures don't, so
 * `uvScale` compensates a known group scale and every pad stripes at one pitch.
 */
function makeHazardBand(uvScale = 1): Group {
  const band = new Group();
  band.name = 'hazard-band';
  // ONE shared texture + material for every pad.
  hazardMat ??= new MeshBasicMaterial({
    map: hazardTexture(),
    transparent: true,
    opacity: 0.85,
    side: DoubleSide,
  });
  const width = 0.075;
  const inset = 0.016; // hold the band clear of the neon tube's halo
  const n = OCTAGON_VERTICES.length;

  // Inward unit normal of every edge (edge i runs vertex i → i+1).
  const normals: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [ax, az] = OCTAGON_VERTICES[i];
    const [bx, bz] = OCTAGON_VERTICES[(i + 1) % n];
    const L = Math.hypot(bx - ax, bz - az);
    let nx = -(bz - az) / L;
    let nz = (bx - ax) / L;
    if (nx * ((ax + bx) / 2) + nz * ((az + bz) / 2) > 0) {
      nx = -nx;
      nz = -nz;
    }
    normals.push([nx, nz]);
  }
  /** Vertex `i` pushed `d` inward — where its two offset edge lines cross. */
  const mitre = (i: number, d: number): [number, number] => {
    const [px, pz] = normals[(i - 1 + n) % n]; // edge arriving at this vertex
    const [qx, qz] = normals[i]; // edge leaving it
    const [vx, vz] = OCTAGON_VERTICES[i];
    const det = px * qz - pz * qx;
    if (Math.abs(det) < 1e-6) return [vx + d * px, vz + d * pz]; // straight run
    const a = vx * px + vz * pz + d;
    const b = vx * qx + vz * qz + d;
    return [(a * qz - b * pz) / det, (px * b - qx * a) / det];
  };

  const outer = OCTAGON_VERTICES.map((_, i) => mitre(i, inset));
  const inner = OCTAGON_VERTICES.map((_, i) => mitre(i, inset + width));

  // u runs the perimeter, v across the width. Rounding the total tile count to
  // a whole number is what lets the stripes meet seamlessly at the wrap.
  let perim = 0;
  const run: number[] = [0];
  for (let i = 0; i < n; i++) {
    perim += Math.hypot(outer[(i + 1) % n][0] - outer[i][0], outer[(i + 1) % n][1] - outer[i][1]);
    run.push(perim);
  }
  const tiles = Math.max(1, Math.round(perim * uvScale * 6));

  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const j = i % n;
    const u = (run[i] / perim) * tiles;
    pos.push(outer[j][0], DECK_TOP, outer[j][1]);
    uvs.push(u, 0);
    pos.push(inner[j][0], DECK_TOP, inner[j][1]);
    uvs.push(u, 1);
  }
  // Duplicate the seam ring (i === n) so the wrap gets u = tiles, not u = 0.
  for (let i = 0; i < n; i++) {
    const o = i * 2;
    idx.push(o, o + 2, o + 3, o, o + 3, o + 1);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  band.add(new Mesh(geo, hazardMat));
  band.visible = false; // boss pedestals only — see setPlatformHazard
  return band;
}

/** Show/hide a pedestal's hazard kick-band. On for a boss's ground only. */
export function setPlatformHazard(pad: Object3D, on: boolean): void {
  const band = pad.getObjectByName('hazard-band');
  if (band) band.visible = on;
}

/** Bolted corner studs at each rim vertex — armour the silhouette. */
function makeCornerBolts(): Group {
  const bolts = new Group();
  bolts.name = 'corner-bolts';
  boltGeo ??= new CylinderGeometry(0.028, 0.035, 0.035, 8);
  boltMat ??= new MeshStandardMaterial({ color: 0x202329, metalness: 0.96, roughness: 0.22 });
  for (const [x, z] of OCTAGON_VERTICES) {
    const bolt = new Mesh(boltGeo, boltMat);
    bolt.position.set(x * 0.97, 0.018, z * 0.97);
    bolts.add(bolt);
  }
  return bolts;
}

/**
 * One boxer's pedestal: a diamond-plate steel slab sunk so its top face sits
 * at floor level (your real floor IS the platform top), hazard banding and
 * corner bolts around the rim, and a thin team-colour glow line on the edge.
 */
export function makePlatform(color: number, groupScale = 1): Group {
  const group = new Group();

  plateMaps ??= diamondPlateTextures();
  // ExtrudeGeometry UVs are in shape units (metres): repeat = tiles per metre.
  plateMaps.map.repeat.set(5, 5);
  plateMaps.bumpMap.repeat.set(5, 5);
  const slabMat = new MeshStandardMaterial({
    color: 0x9aa0ab, // tint over the baked dark-steel tones in the map
    map: plateMaps.map,
    bumpMap: plateMaps.bumpMap,
    bumpScale: 1.1,
    emissive: color,
    emissiveIntensity: 0.08,
    metalness: 0.92, // glistens off scene.environment (RoomEnvironment)
    roughness: 0.28,
  });
  slabMat.userData.role = 'slab';
  const slab = new Mesh(octagonSlab(OCTAGON_VERTICES, PLATFORM.thickness), slabMat);
  // Top face at the floor line, body glowing faintly below. NB the extrude
  // BEVEL overhangs both ends, so the actual top face sits at +bevel (0.015)
  // — anything painted on the deck must clear that, not y=0.
  slab.position.y = -PLATFORM.thickness;
  group.add(slab);

  // `groupScale` is the scale the CALLER will put on this group (the raid pit
  // stands at 2.4×). Stripe pitch is baked into UVs, which scale with the mesh,
  // so it has to be compensated here or the boss pad stripes 2.4× coarser than
  // every boxer's pad — which is exactly what it used to do.
  group.add(makeHazardBand(groupScale));
  group.add(makeCornerBolts());
  group.add(makeNeonRim(color));

  // --- Per-skin ornaments (hidden; applyPlatformSkin shows one set) ---
  // INFERNO: upright glowing blade fins at every rim vertex.
  const fins = new Group();
  fins.name = 'vertex-fins';
  const finMat = new MeshBasicMaterial({ color: new Color(color).lerp(new Color(0xffffff), 0.45) });
  finMat.userData.role = 'neon-core';
  for (const [x, z] of OCTAGON_VERTICES) {
    const fin = new Mesh(new BoxGeometry(0.018, 0.085, 0.05), finMat);
    fin.position.set(x * 1.02, 0.045, z * 1.02);
    fin.rotation.y = Math.atan2(x, z); // blade faces outward, radially
    fins.add(fin);
  }
  fins.userData.skinTag = 'inferno';
  fins.visible = false;
  group.add(fins);

  // XD: a white grin painted on the deck (X eyes + a capital-D mouth), shown
  // only for the 'xdface' skin. A flat decal just above the slab's top face —
  // which is at +bevel, NOT y=0: at its old 0.004 it sat INSIDE the steel and
  // never rendered at all.
  const face = new Mesh(
    new PlaneGeometry(1.18, 1.18),
    new MeshBasicMaterial({ map: xdFaceTexture(), transparent: true, depthWrite: false }),
  );
  face.rotation.x = -Math.PI / 2; // lay it flat, texture-up pointing -Z (at the foe)
  face.position.y = DECK_TOP;
  face.renderOrder = 2;
  face.userData.skinTag = 'xdface';
  face.visible = false;
  group.add(face);

  // VOLT: a big lightning bolt struck across the deck, shown only for 'volt'.
  // A real raised neon mesh (the transparent-decal approach vanished against
  // the dark slab) — flat ShapeGeometry a hair above the deck, painted in the
  // same unlit neon-core white-lerp the INFERNO fins use, so it team-tints on
  // opponent pads too.
  const boltShape = new Shape();
  const boltRot = 0.35; // struck across the deck on a diagonal
  const boltScale = 1.35;
  (
    [
      [0.1, 0.42],
      [-0.14, -0.02],
      [0.015, -0.02],
      [-0.1, -0.42],
      [0.14, 0.06],
      [-0.015, 0.06],
    ] as [number, number][]
  ).forEach(([px, py], i) => {
    const bx = (px * Math.cos(boltRot) - py * Math.sin(boltRot)) * boltScale;
    const by = (px * Math.sin(boltRot) + py * Math.cos(boltRot)) * boltScale;
    if (i === 0) boltShape.moveTo(bx, by);
    else boltShape.lineTo(bx, by);
  });
  const boltMat = new MeshBasicMaterial({ color: new Color(color).lerp(new Color(0xffffff), 0.45) });
  boltMat.userData.role = 'neon-core';
  const bolt = new Mesh(new ShapeGeometry(boltShape), boltMat);
  bolt.rotation.x = -Math.PI / 2; // lay it flat; shape +y points -Z (at the foe)
  bolt.position.y = DECK_TOP + 0.001; // clear of the (never co-shown) grin plane too
  bolt.userData.skinTag = 'volt';
  bolt.visible = false;
  group.add(bolt);

  // SYNTHWAVE: an outrun neon grid etched across the deck — raised thin bars
  // (the same unlit neon-core treatment as the fins/bolt, so it team-tints),
  // clipped to the octagon's outline. This is what keeps the pad from reading
  // as just another purple recolour next to PLASMA.
  const grid = new Group();
  grid.name = 'deck-grid';
  const gridMat = new MeshBasicMaterial({ color: new Color(color).lerp(new Color(0xffffff), 0.45) });
  gridMat.userData.role = 'neon-core';
  /**
   * The deck's TRUE half-extent, derived from the octagon rather than guessed.
   *
   * The old grid ran bars only across z ∈ [−0.5, 0.5] and x ∈ [−0.6, 0.6] on a
   * deck that reaches ±0.75 and ±0.86, with the run lengths taken from
   * hand-fitted constants — so it sat as a small patch marooned in the middle
   * of the pad with bare steel all round it, nowhere near the rim. These walk
   * the real outline: full width until the chamfer starts, then tapering with
   * it to the corner.
   */
  const inset = 0.03; // hold the ends just inside the rim tube
  const halfW = (z: number): number => {
    const a = Math.abs(z);
    if (a <= CHAMFER) return OCTAGON_HALF_WIDTH - inset;
    const t = (a - CHAMFER) / (OCTAGON_HALF_DEPTH - CHAMFER);
    return OCTAGON_HALF_WIDTH - (OCTAGON_HALF_WIDTH - EDGE_HALF) * t - inset;
  };
  const halfD = (x: number): number => {
    const a = Math.abs(x);
    if (a <= EDGE_HALF) return OCTAGON_HALF_DEPTH - inset;
    const t = (a - EDGE_HALF) / (OCTAGON_HALF_WIDTH - EDGE_HALF);
    return OCTAGON_HALF_DEPTH - (OCTAGON_HALF_DEPTH - CHAMFER) * t - inset;
  };
  // Even pitch out to the rim in both directions, so the grid actually reads
  // as a grid laid over the whole deck.
  const zPitch = 0.25;
  for (let z = -Math.floor(OCTAGON_HALF_DEPTH / zPitch) * zPitch; z <= OCTAGON_HALF_DEPTH; z += zPitch) {
    const len = halfW(z) * 2;
    if (len <= 0.05) continue;
    const bar = new Mesh(new BoxGeometry(len, 0.008, 0.012), gridMat);
    bar.position.set(0, DECK_TOP, z);
    grid.add(bar);
  }
  const xPitch = 0.28;
  for (let x = -Math.floor(OCTAGON_HALF_WIDTH / xPitch) * xPitch; x <= OCTAGON_HALF_WIDTH; x += xPitch) {
    const len = halfD(x) * 2;
    if (len <= 0.05) continue;
    const bar = new Mesh(new BoxGeometry(0.012, 0.008, len), gridMat);
    bar.position.set(x, DECK_TOP, 0);
    grid.add(bar);
  }
  grid.userData.skinTag = 'synthwave';
  grid.visible = false;
  group.add(grid);

  // GOLD RUSH: the one premium pad that had nothing struck into it — just a
  // tint, which is why it read as a painted floor next to VOLT's bolt and
  // SYNTHWAVE's grid. A minted MEDALLION at the centre of the deck inside a
  // fine border ring, both in the same unlit neon-core the other ornaments
  // use, so they team-tint on an opponent's pad too.
  const bullion = new Group();
  bullion.name = 'gold-trim';
  const goldMat = new MeshBasicMaterial({ color: new Color(color).lerp(new Color(0xffffff), 0.45) });
  goldMat.userData.role = 'neon-core';
  const border = new Mesh(new TorusGeometry(0.56, 0.007, 8, 56), goldMat);
  border.rotation.x = -Math.PI / 2;
  border.position.y = DECK_TOP;
  bullion.add(border);
  // The medallion: a low struck disc with a raised lip round its edge.
  const medal = new Mesh(new CylinderGeometry(0.17, 0.18, 0.01, 40), goldMat);
  medal.position.y = DECK_TOP + 0.004;
  bullion.add(medal);
  const medalLip = new Mesh(new TorusGeometry(0.17, 0.009, 8, 40), goldMat);
  medalLip.rotation.x = -Math.PI / 2;
  medalLip.position.y = DECK_TOP + 0.009;
  bullion.add(medalLip);
  // Rays struck out of the medallion toward the border — a minted sunburst.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const ray = new Mesh(new BoxGeometry(0.012, 0.008, 0.11), goldMat);
    ray.position.set(Math.sin(a) * 0.4, DECK_TOP, Math.cos(a) * 0.4);
    ray.rotation.y = a;
    bullion.add(ray);
  }
  bullion.userData.skinTag = 'goldrush';
  bullion.visible = false;
  group.add(bullion);

  // BLAZING: not merely a flame decal. The earned pad carries a white-hot
  // deck brand, a burning outer rail and an animated flame crown at every
  // lifting off the steel. The low effects stay outside the standing area, so
  // the silhouette reads as a trophy without filling the player's play space.
  const flameTongue = (h: number): Shape => {
    const w = h * 0.62;
    const s = new Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(-w * 0.55, h * 0.12, -w * 0.42, h * 0.55, -w * 0.1, h * 0.62);
    s.bezierCurveTo(-w * 0.28, h * 0.8, w * 0.02, h * 0.9, w * 0.08, h);
    s.bezierCurveTo(w * 0.42, h * 0.68, w * 0.55, h * 0.3, 0, 0);
    return s;
  };
  const FLAME_H = 1.15;
  const flame = new Group();
  flame.name = 'blazing-platform-fx';
  flame.userData.skinTag = 'blazing';
  flame.userData.platformFx = 'blazing';
  const outerMat = new MeshBasicMaterial({
    color: new Color(color).lerp(new Color(0xffffff), 0.45),
    transparent: true,
    opacity: 0.82,
    side: DoubleSide,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  outerMat.userData.role = 'neon-core';
  const outer = new Mesh(new ShapeGeometry(flameTongue(FLAME_H)), outerMat);
  outer.userData.fxRole = 'blazing-emblem';
  const coreMat = new MeshBasicMaterial({
    color: 0xffc21a,
    transparent: true,
    opacity: 0.88,
    side: DoubleSide,
    blending: AdditiveBlending,
    depthWrite: false,
  }); // no role: fire's amber heart is never retinted
  const core = new Mesh(new ShapeGeometry(flameTongue(FLAME_H * 0.55)), coreMat);
  core.position.z = 0.001; // proud of the outer tongue
  core.userData.fxRole = 'blazing-emblem-core';
  const deckBrand = new Group();
  deckBrand.add(outer, core);
  deckBrand.rotation.x = -Math.PI / 2; // flat on deck, tip toward the foe
  deckBrand.position.set(0, DECK_TOP + 0.004, FLAME_H / 2);
  flame.add(deckBrand);

  const fireRailMat = outerMat.clone();
  fireRailMat.userData.role = 'neon-halo';
  fireRailMat.opacity = 0.42;
  const fireRail = new Mesh(new TorusGeometry(0.735, 0.027, 6, 56), fireRailMat);
  fireRail.rotation.x = Math.PI / 2;
  fireRail.position.y = DECK_TOP + 0.012;
  fireRail.userData.fxRole = 'blazing-rail';
  flame.add(fireRail);

  // Crown every corner with a two-tone lick of fire. Each crown is a vertical
  // double-sided mesh, readable from the pad opposite as well as from above.
  const jetOuterGeo = new ShapeGeometry(flameTongue(0.24));
  const jetCoreGeo = new ShapeGeometry(flameTongue(0.14));
  const jetCoreMat = coreMat.clone();
  OCTAGON_VERTICES.forEach(([x, z], i) => {
    // Every corner, all eight — the pad is a trophy, and crowning only the
    // alternate vertices left it looking half-lit from most angles rather
    // than deliberate.
    const jet = new Group();
    jet.position.set(x * 0.94, DECK_TOP, z * 0.94);
    jet.rotation.y = Math.atan2(x, z);
    jet.userData.fxRole = 'blazing-jet';
    jet.userData.fxPhase = i * 0.79;
    // CROSSED pair, not a single card. A flat flame is a flat flame: seen
    // edge-on it collapses to a sliver, and with eight of them round the rim
    // two or three are always near edge-on from wherever you stand. The second
    // card at 90° keeps every corner reading as fire from any angle.
    for (const yaw of [0, Math.PI / 2]) {
      const card = new Group();
      card.rotation.y = yaw;
      const shell = new Mesh(jetOuterGeo, outerMat);
      const heart = new Mesh(jetCoreGeo, jetCoreMat);
      heart.position.z = 0.003;
      card.add(shell, heart);
      jet.add(card);
    }
    flame.add(jet);
  });

  // No point light here (nor on TIDEBREAKER). A deck lamp is never just its
  // own shading cost: adding a light to the scene changes every lit material's
  // shader permutation, so wearing the pad recompiles the whole arena — a
  // hitch — and then charges for an extra light per pixel for as long as it is
  // worn. The emissive jets and embers carry the look on their own.
  flame.visible = false;
  group.add(flame);

  // TIDEBREAKER: a luminous pool, a rolling crest at every outline point and hanging
  // droplets. It should look as if GOOPLIATH is still alive beneath the slab,
  // not like somebody painted a green raindrop on ordinary diamond plate.
  const D = 0.52;
  const gel = new Shape();
  gel.moveTo(0, D); // pinched crown
  gel.quadraticCurveTo(0.95 * D, -0.1 * D, 0.55 * D, -0.55 * D);
  gel.quadraticCurveTo(0, -0.98 * D, -0.55 * D, -0.55 * D); // round belly
  gel.quadraticCurveTo(-0.95 * D, -0.1 * D, 0, D);
  const tide = new Group();
  tide.name = 'tidebreaker-platform-fx';
  tide.userData.skinTag = 'tidebreaker';
  tide.userData.platformFx = 'tidebreaker';
  const gelMat = new MeshBasicMaterial({
    color: new Color(color).lerp(new Color(0xffffff), 0.45),
    transparent: true,
    opacity: 0.78,
    side: DoubleSide,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  gelMat.userData.role = 'neon-core';
  const drop = new Mesh(new ShapeGeometry(gel), gelMat);
  drop.rotation.x = -Math.PI / 2; // crown pointing at the foe
  drop.position.y = DECK_TOP + 0.006;
  drop.userData.fxRole = 'tide-emblem';
  tide.add(drop);

  const poolMat = new MeshBasicMaterial({
    color: 0x24ff9a,
    transparent: true,
    opacity: 0.18,
    side: DoubleSide,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  poolMat.userData.role = 'neon-halo';
  const pool = new Mesh(new CircleGeometry(0.62, 40), poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = DECK_TOP + 0.002;
  pool.userData.fxRole = 'tide-pool';
  tide.add(pool);

  for (let i = 0; i < 2; i++) {
    const ringMat = poolMat.clone();
    ringMat.opacity = 0.34;
    const ring = new Mesh(new TorusGeometry(0.35 + i * 0.18, 0.011, 5, 40), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = DECK_TOP + 0.011 + i * 0.002;
    ring.userData.fxRole = 'tide-ring';
    ring.userData.fxPhase = i / 2;
    tide.add(ring);
  }

  const wave = new Shape();
  wave.moveTo(-0.17, 0);
  wave.bezierCurveTo(-0.09, 0.01, -0.06, 0.12, 0.02, 0.16);
  wave.bezierCurveTo(0.02, 0.09, 0.1, 0.05, 0.17, 0.06);
  wave.lineTo(0.17, 0);
  wave.closePath();
  const waveGeo = new ShapeGeometry(wave);
  OCTAGON_VERTICES.forEach(([x, z], i) => {
    const crest = new Mesh(waveGeo, gelMat);
    crest.position.set(x * 0.93, DECK_TOP, z * 0.93);
    crest.rotation.y = Math.atan2(x, z);
    crest.userData.fxRole = 'tide-crest';
    crest.userData.fxPhase = i * 0.73;
    tide.add(crest);
  });

  // Long luminous drops hang below alternate corners, giving the pad an
  // unmistakable profile even when the deck art is foreshortened.
  const dripGeo = new SphereGeometry(0.05, 8, 6);
  OCTAGON_VERTICES.forEach(([x, z], i) => {
    if (i % 4) return; // two opposing drips are enough to carry the silhouette
    const drip = new Mesh(dripGeo, gelMat);
    drip.position.set(x * 0.9, -PLATFORM.thickness - 0.07, z * 0.9);
    drip.scale.set(0.65, 1.75 + i * 0.04, 0.65);
    drip.userData.fxRole = 'tide-drip';
    drip.userData.fxPhase = i * 0.55;
    drip.userData.fxBaseY = drip.position.y;
    tide.add(drip);
  });
  tide.visible = false; // no point light — see BLAZING above
  group.add(tide);

  // EMBER: the classic look — banding + bolts, no extra furniture.
  return group;
}

/** A white "XD" on transparent — painted huge across the deck of the black
 *  premium platform: one big X and an equal-size D, side by side and centred,
 *  reading left-to-right (horizontal). Built once and shared by every pedestal. */
let xdFaceTex: CanvasTexture | undefined;
function xdFaceTexture(): CanvasTexture {
  if (xdFaceTex) return xdFaceTex;
  const s = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f6f8ff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 320px system-ui, sans-serif';
  // Pre-mirror horizontally: the decal lies flat facing the foe, so viewed
  // from that side an un-mirrored draw reads backwards ("DX"). Flipping the
  // canvas in X makes it read "XD" the right way round on the deck.
  ctx.translate(s, 0);
  ctx.scale(-1, 1);
  ctx.fillText('X', s * 0.28, s * 0.5);
  ctx.fillText('D', s * 0.72, s * 0.5);
  xdFaceTex = new CanvasTexture(canvas);
  xdFaceTex.colorSpace = SRGBColorSpace;
  xdFaceTex.minFilter = LinearFilter;
  return xdFaceTex;
}

/** Recolour a platform's neon rim + slab emissive to a team tint. (Exported
 *  for CampaignSystem: GOOPLIATH's ground goes goop-green for his fights.) */
export function tintPlatform(group: Object3D, color: number): void {
  const core = new Color(color).lerp(new Color(0xffffff), 0.45);
  const tint = new Color(color);
  group.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const role = (mat as MeshBasicMaterial).userData?.role;
      if (role === 'neon-core') (mat as MeshBasicMaterial).color.copy(core);
      else if (role === 'neon-halo') (mat as MeshBasicMaterial).color.copy(tint);
      else if (role === 'slab') (mat as MeshStandardMaterial).emissive.copy(tint);
    }
  });
}

/** Name of the platform mesh for an other-fighter slot (1 keeps the legacy id). */
export function platformName(slot: number): string {
  return slot === 1 ? 'opponent-platform' : `opponent-platform-${slot}`;
}

/**
 * Lay the platforms out for the current bout's LOCAL roster: the player pedestal
 * stays at the origin, each other-fighter pedestal moves to its slot (position +
 * facing yaw), recolours to its team tint and shows only if the bout uses it.
 */
export function applyArenaLayout(scene: Object3D): void {
  const roster = localLayout();
  for (let slot = 1; slot <= MAX_OPPONENTS; slot++) {
    const pad = scene.getObjectByName(platformName(slot));
    if (!pad) continue;
    const seat = roster[slot];
    if (seat) {
      pad.visible = true;
      pad.position.set(seat.pos[0], seat.pos[1], seat.pos[2]);
      pad.rotation.y = seat.yaw;
      tintPlatform(pad, teamColor(seat.team));
      // A re-seated pad is a BOXER's pad again until a titan claims it; the
      // campaign turns its own boss pedestal's band back on when it takes over.
      setPlatformHazard(pad, false);
    } else {
      pad.visible = false;
    }
  }
  // The RAID pit: a fifth, boss-tinted pedestal at the arc's focus. Every raid
  // seat faces the anchor from RAID_RING_RADIUS away, so it lands at
  // (0,0,-RAID_RING_RADIUS) in EVERY player's frame — dead ahead, far out.
  const pit = scene.getObjectByName('raid-boss-platform');
  if (pit) pit.visible = app.arcade === 'raid';
}

export function buildArena(world: World): Object3D {
  const scene = world.scene;

  const arena = new Group();
  arena.name = 'arena';

  // Your pedestal: ember rim, underfoot.
  const mine = makePlatform(PALETTE.ember);
  mine.name = 'player-platform';
  arena.add(mine);

  // The other fighters' pedestals — same shape, recoloured/placed per layout by
  // applyArenaLayout. Built once at the MAX roster size; spare slots stay hidden.
  for (let slot = 1; slot <= MAX_OPPONENTS; slot++) {
    const pad = makePlatform(PALETTE.coolFlame);
    pad.name = platformName(slot);
    pad.position.set(0, 0, -ARENA_GAP);
    pad.visible = false;
    arena.add(pad);
  }

  // The RAID pit pedestal — the titan's own ground at the arc's focus, worn in
  // danger red. Hidden outside raids (applyArenaLayout owns its visibility).
  // Stretched wide: every raid titan is GOLIATH-sized or bigger, so a
  // boxer-sized pad would read like a coaster under it.
  const pit = makePlatform(PALETTE.danger, 2.4);
  pit.name = 'raid-boss-platform';
  pit.position.set(0, 0, -RAID_RING_RADIUS);
  pit.scale.set(2.4, 1, 2.4);
  pit.visible = false;
  setPlatformHazard(pit, true); // the pit is only ever a titan's ground
  arena.add(pit);

  // "FIRE FIGHT" signage hung high behind the opponent.
  createTitleBanner(scene);

  // --- Lighting: warm-vs-cool so both fires and the steel read nicely ---
  arena.add(new HemisphereLight(0xcfd8e8, 0xffd9b0, 1.2));
  const key = new PointLight(PALETTE.flame, 7, 14);
  key.position.set(0, 3, -ARENA_GAP / 2);
  arena.add(key);

  scene.add(arena);
  // Start in the classic duel layout (slot 1 across the gap, the rest hidden).
  applyArenaLayout(scene);
  return arena;
}
