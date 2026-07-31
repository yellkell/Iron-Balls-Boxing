/**
 * Boot intro — the store-game opening ritual, shown once per page load, the
 * moment the XR session starts: black screen, "yellkell.com" fades in and out
 * (3s), the FIRE FIGHT neon fades in and out (3s), then the curtain drops in
 * a single frame — boom, you're at the menu and the lobby music is already
 * playing (main.ts starts the decode at launch and fires playback in onDone).
 *
 * Head-locked, same trick as LoadingOverlay: DOM isn't visible inside an
 * immersive session, so the cards are camera-attached planes over an
 * oversized black shade. Nothing is paused or hidden — the whole lobby keeps
 * building behind the shade, which is what makes the final cut instant.
 * Not skippable by design (it's six seconds, and the silence over the
 * publisher card is exactly where the music track finishes decoding).
 */

import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type PerspectiveCamera,
} from 'three';

const CARD_SECONDS = 3;
const FADE_SECONDS = 0.5;
const TOTAL_SECONDS = CARD_SECONDS * 2;
/** Fire the music cue this far BEFORE the curtain drops: starting a WebAudio
 *  source carries a beat of output latency (context/hardware spin-up), so a
 *  cue on the cut itself lands audibly late. This lead makes sound and
 *  reveal hit together. (Timing is crash-safe by construction — the old
 *  launch crash was about <audio> elements touching Android's media-session
 *  bridge, and MusicTrack/WebAudio never goes near it at any start time.) */
const MUSIC_LEAD_SECONDS = 0.35;

/** Per-card fade envelope: 0.5s in, 2s hold, 0.5s out. */
function envelope(t: number): number {
  if (t <= 0 || t >= CARD_SECONDS) return 0;
  if (t < FADE_SECONDS) return t / FADE_SECONDS;
  if (t > CARD_SECONDS - FADE_SECONDS) return (CARD_SECONDS - t) / FADE_SECONDS;
  return 1;
}

function makeCard(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): {
  mesh: Mesh;
  material: MeshBasicMaterial;
  texture: CanvasTexture;
  redraw: (draw2: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) => void;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 640;
  const ctx = canvas.getContext('2d')!;
  const render = (fn: (c: CanvasRenderingContext2D, w: number, h: number) => void): void => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fn(ctx, canvas.width, canvas.height);
  };
  render(draw);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(new PlaneGeometry(2.08, 1.04), material);
  mesh.position.z = -1.65;
  mesh.renderOrder = 10_001;
  return {
    mesh,
    material,
    texture,
    redraw: (draw2) => {
      render(draw2);
      texture.needsUpdate = true;
    },
  };
}

function drawPublisher(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2;
  ctx.font = '500 118px system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(255,255,255,0.45)';
  ctx.shadowBlur = 30;
  ctx.fillText('yellkell.com', cx, h / 2 - 26);
  ctx.shadowBlur = 0;
  ctx.font = '400 30px system-ui, sans-serif';
  ctx.fillStyle = '#9aa0a8';
  ctx.fillText('P R E S E N T S', cx, h / 2 + 84);
}

/** Soft elliptical red pool behind the mark. Elliptical and sized to reach
 *  zero BEFORE the canvas borders — a circular pool tall enough to glow gets
 *  guillotined by the 1280x640 canvas top/bottom, which reads as faint square
 *  edges against the void. */
function drawPool(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 0.5);
  const pool = ctx.createRadialGradient(0, 0, 20, 0, 0, 580);
  pool.addColorStop(0, 'rgba(196,18,8,0.55)');
  pool.addColorStop(0.55, 'rgba(196,18,8,0.18)');
  pool.addColorStop(1, 'rgba(196,18,8,0)');
  ctx.fillStyle = pool;
  ctx.fillRect(-640, -640, 1280, 1280);
  ctx.restore();
}

/** The FIRE FIGHT mark — the committed neon sign art when available (same
 *  crop as LoadingOverlay), else the banner's stencil colourway. The red
 *  pool sits behind either, echoing the lobby sign's breathing glow. */
function drawMark(ctx: CanvasRenderingContext2D, w: number, h: number, logo: HTMLImageElement | null): void {
  const cx = w / 2;
  const cy = h / 2;

  if (logo && logo.complete && logo.naturalWidth > 0) {
    // The committed sign is a PHOTO — neon script on a light wall that gets
    // BRIGHTER towards the frame's corners. Any straight crop shows as a lit
    // rectangle against the pure-black shade, so: crop tight to the lettering,
    // then dissolve the crop's edges to transparent with a radial feather
    // (destination-in). The photo's own red halo does the glow-pool job.
    const sx = logo.naturalWidth * 0.22;
    const sy = logo.naturalHeight * 0.06;
    const sw = logo.naturalWidth * 0.53;
    const sh = logo.naturalHeight * 0.72;
    const width = 680;
    const height = (width * sh) / sw;
    ctx.drawImage(logo, sx, sy, sw, sh, cx - width / 2, cy - height / 2, width, height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, height / width);
    const feather = ctx.createRadialGradient(0, 0, width * 0.3, 0, 0, width * 0.5);
    feather.addColorStop(0, 'rgba(0,0,0,1)');
    feather.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = feather;
    ctx.fillRect(-width / 2, -width / 2, width, width);
    ctx.restore();
    // Now lay the glow pool BEHIND the feathered sign: destination-over only
    // paints where the canvas is still transparent, so the sign keeps its
    // photo-true core and the pool takes over where the feather fades out.
    ctx.globalCompositeOperation = 'destination-over';
    drawPool(ctx, cx, cy);
    ctx.globalCompositeOperation = 'source-over';
    return;
  }

  drawPool(ctx, cx, cy);

  ctx.font = "900 150px 'Arial Black', system-ui, sans-serif";
  const fire = ctx.createLinearGradient(0, cy - 75, 0, cy + 75);
  fire.addColorStop(0, '#fff3cf');
  fire.addColorStop(0.5, '#ffb054');
  fire.addColorStop(1, '#ff7a18');
  ctx.fillStyle = fire;
  ctx.shadowColor = 'rgba(255,122,24,0.9)';
  ctx.shadowBlur = 34;
  ctx.fillText('FIRE', cx - 235, cy);
  ctx.fillStyle = '#eef6ff';
  ctx.shadowColor = 'rgba(79,183,255,0.85)';
  ctx.shadowBlur = 26;
  ctx.fillText('FIGHT', cx + 250, cy);
  ctx.shadowBlur = 0;
}

/**
 * Play the boot sequence on the given camera. Fires `onMusicCue` exactly once,
 * MUSIC_LEAD_SECONDS before the shade drops (and guaranteed no later than
 * teardown, whatever happens) — hang the lobby music on it.
 */
export function runBootIntro(camera: PerspectiveCamera, onMusicCue: () => void): void {
  const root = new Group();

  const shade = new Mesh(
    // Oversized to cover the whole per-eye frustum (see LoadingOverlay).
    // transparent:true (at full opacity) is LOAD-BEARING: it moves the shade
    // into the transparent render pass, which three.js draws AFTER all opaque
    // geometry. An opaque shade gets painted over by every transparent object
    // in the live lobby behind it (glows, panels, fx) — the curtain must be
    // the last transparent draw (renderOrder 10k) to actually black out a
    // scene we intentionally never hide.
    new PlaneGeometry(20, 20),
    new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 1, depthTest: false, depthWrite: false }),
  );
  shade.position.z = -1.7;
  shade.renderOrder = 10_000;

  const pub = makeCard(drawPublisher);
  const logo = makeCard((ctx, w, h) => drawMark(ctx, w, h, null));

  // Swap in the handmade neon art once it decodes (fallback stays otherwise).
  const sign = new Image();
  sign.decoding = 'async';
  sign.onload = () => logo.redraw((ctx, w, h) => drawMark(ctx, w, h, sign));
  sign.src = '/signs/fire-fight.png';

  root.add(shade, pub.mesh, logo.mesh);
  camera.add(root);

  const started = performance.now();
  let finished = false;
  let cued = false;

  const cue = (): void => {
    if (cued) return;
    cued = true;
    onMusicCue();
  };

  const finish = (): void => {
    if (finished) return;
    finished = true;
    window.clearInterval(timer);
    try {
      camera.remove(root);
      for (const card of [pub, logo]) {
        card.mesh.geometry.dispose();
        card.material.dispose();
        card.texture.dispose();
      }
      shade.geometry.dispose();
      (shade.material as MeshBasicMaterial).dispose();
    } finally {
      cue(); // whatever happens to the props, the music cue always fires
    }
  };

  const timer = window.setInterval(() => {
    const t = (performance.now() - started) / 1000;
    if (t >= TOTAL_SECONDS - MUSIC_LEAD_SECONDS) cue();
    if (t >= TOTAL_SECONDS) {
      finish();
      return;
    }
    pub.material.opacity = envelope(t);
    logo.material.opacity = envelope(t - CARD_SECONDS);
  }, 33);
}
