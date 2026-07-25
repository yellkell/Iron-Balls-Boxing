/**
 * Procedural emblems for the shop / locker tiles — so a skin reads as a picture,
 * not just a word. Avatars get an animal silhouette (the metallic-animal head
 * each skin's name comes from) and the KNIGHT a heraldic shield; platforms get
 * a little octagon pad swatch painted in their colours. All drawn into a canvas
 * 2D context, sized around a centre (cx, cy) and radius r.
 */

import type { PlatformSkin } from '../avatar/skins.js';

function hex(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** The avatar emblem for a skin id, filled in `color`. */
export function drawAvatarIcon(ctx: CanvasRenderingContext2D, id: string, cx: number, cy: number, r: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  switch (id) {
    case 'cobalt':
      drawBear(ctx, cx, cy, r);
      break;
    case 'valkyrie':
      drawEagle(ctx, cx, cy, r);
      break;
    case 'knight':
      drawShield(ctx, cx, cy, r);
      break;
    case 'stallion':
      drawStallion(ctx, cx, cy, r);
      break;
    case 'wolf':
      drawWolf(ctx, cx, cy, r);
      break;
    case 'frog':
      drawFrog(ctx, cx, cy, r);
      break;
    case 'bunny':
      drawBunny(ctx, cx, cy, r);
      break;
    case 'crimson':
    default:
      drawPanther(ctx, cx, cy, r);
      break;
  }
  ctx.restore();
}

/** Wolf head-on: a single lean silhouette — tall pricked ears, jagged cheek
 *  fur, tapering hard to a narrow chin. The panther's cousin, but pointier
 *  everywhere. */
function drawWolf(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const x = (u: number): number => cx + u * r;
  const y = (v: number): number => cy + v * r;
  ctx.beginPath();
  ctx.moveTo(x(-0.5), y(-1.0)); // left ear tip
  ctx.lineTo(x(-0.08), y(-0.42)); // down its inner edge to the valley
  ctx.lineTo(x(0.08), y(-0.42));
  ctx.lineTo(x(0.5), y(-1.0)); // right ear tip
  ctx.lineTo(x(0.62), y(-0.3)); // outer edge to the temple
  // Jagged cheek fur: two points flicking out, stepping inward.
  ctx.lineTo(x(0.78), y(0.02));
  ctx.lineTo(x(0.52), y(0.14));
  ctx.lineTo(x(0.62), y(0.38));
  ctx.lineTo(x(0.34), y(0.44));
  // The long taper to a narrow chin.
  ctx.lineTo(x(0.1), y(0.92));
  ctx.lineTo(x(-0.1), y(0.92));
  ctx.lineTo(x(-0.34), y(0.44));
  ctx.lineTo(x(-0.62), y(0.38));
  ctx.lineTo(x(-0.52), y(0.14));
  ctx.lineTo(x(-0.78), y(0.02));
  ctx.lineTo(x(-0.62), y(-0.3));
  ctx.closePath();
  ctx.fill();
  // Nose, knocked out dark at the chin.
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#06070b';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.74, r * 0.11, r * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Frog head-on: the wide flat face with two dome eyes riding the crown and
 *  the smile line carved across. */
function drawFrog(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  // Eye domes first (behind the face), perched on top.
  ctx.beginPath();
  ctx.arc(cx - r * 0.48, cy - r * 0.5, r * 0.32, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.48, cy - r * 0.5, r * 0.32, 0, Math.PI * 2);
  ctx.fill();
  // The wide low face.
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.12, r * 0.95, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#06070b';
  ctx.strokeStyle = '#06070b';
  // Horizontal slit pupils.
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * r * 0.48, cy - r * 0.52, r * 0.15, r * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // The smile, sweeping wide and up into the cheeks.
  ctx.lineWidth = r * 0.09;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.68, cy + r * 0.1);
  ctx.quadraticCurveTo(cx, cy + r * 0.5, cx + r * 0.68, cy + r * 0.1);
  ctx.stroke();
  ctx.restore();
}

/** OSWALD head-on: a big round face under two tall STAND-UP ears, with the
 *  close-set eyes, nose and buck teeth knocked out dark. */
function drawBunny(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  // OSWALD, head-on: the ears first (behind the face) — tall STAND-UP blades
  // leaning out off the crown with a soft break back near the tip.
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * r * 0.36, cy - r * 0.04);
    ctx.quadraticCurveTo(cx + s * r * 0.58, cy - r * 0.56, cx + s * r * 0.5, cy - r * 0.98); // outer edge
    ctx.quadraticCurveTo(cx + s * r * 0.42, cy - r * 1.16, cx + s * r * 0.24, cy - r * 1.0); // round tip
    ctx.quadraticCurveTo(cx + s * r * 0.3, cy - r * 0.5, cx + s * r * 0.1, cy - r * 0.02); // inner edge
    ctx.closePath();
    ctx.fill();
  }
  // The big round face — Oswald is drawn from circles.
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.28, r * 0.6, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#06070b';
  // The big CLOSE-SET eyes — the whole likeness lives here.
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * r * 0.17, cy + r * 0.12, r * 0.14, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Nose + the buck teeth we kept.
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.46, r * 0.09, r * 0.075, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - r * 0.1, cy + r * 0.58, r * 0.09, r * 0.2);
  ctx.fillRect(cx + r * 0.01, cy + r * 0.58, r * 0.09, r * 0.2);
  // Ear inner channels.
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * r * 0.32, cy - r * 0.52, r * 0.075, r * 0.32, s * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Bear head: round skull, two round ears, a paler muzzle bump. */
function drawBear(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.arc(cx - r * 0.62, cy - r * 0.58, r * 0.34, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.62, cy - r * 0.58, r * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.04, r * 0.78, 0, Math.PI * 2);
  ctx.fill();
  // Muzzle, knocked out a touch darker so the snout reads.
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#06070b';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.42, r * 0.3, r * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.32, r * 0.1, 0, Math.PI * 2); // nose
  ctx.fill();
}

/** Panther head: a single clean cat-head SILHOUETTE — two big triangular ears
 *  on a broad, round-cheeked face that tapers to a soft round chin, matching
 *  the classic cat-face emblem. One filled shape, no inner features. */
function drawPanther(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const x = (u: number): number => cx + u * r;
  const y = (v: number): number => cy + v * r;
  ctx.beginPath();
  // Left ear tip, down its inner edge into the valley between the ears…
  ctx.moveTo(x(-0.58), y(-0.98));
  ctx.lineTo(x(0), y(-0.4));
  // …up the right ear's inner edge to its tip, then down its outer edge.
  ctx.lineTo(x(0.58), y(-0.98));
  ctx.lineTo(x(0.8), y(-0.34));
  // Right cheek bulging wide, then the jaw sweeping down to a round chin.
  ctx.quadraticCurveTo(x(0.98), y(0.06), x(0.84), y(0.4));
  ctx.quadraticCurveTo(x(0.6), y(0.82), x(0), y(0.95));
  // Left jaw back up, left cheek, to the left ear's outer base…
  ctx.quadraticCurveTo(x(-0.6), y(0.82), x(-0.84), y(0.4));
  ctx.quadraticCurveTo(x(-0.98), y(0.06), x(-0.8), y(-0.34));
  // …and closePath runs the outer edge of the left ear back up to its tip.
  ctx.closePath();
  ctx.fill();
}

/** Eagle: a head between two swept, spread wings. */
function drawEagle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.1);
    ctx.quadraticCurveTo(cx + s * r * 1.05, cy - r * 0.7, cx + s * r * 1.08, cy + r * 0.18);
    ctx.quadraticCurveTo(cx + s * r * 0.7, cy - r * 0.02, cx + s * r * 0.22, cy + r * 0.34);
    ctx.closePath();
    ctx.fill();
  }
  // Body.
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.1, r * 0.18, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Head + hooked beak.
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.52, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.04, cy - r * 0.58);
  ctx.lineTo(cx - r * 0.3, cy - r * 0.46);
  ctx.lineTo(cx - r * 0.04, cy - r * 0.4);
  ctx.closePath();
  ctx.fill();
}

/** Knight: a heraldic shield with a struck cross. */
function drawShield(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const w = r * 0.82;
  const top = cy - r * 0.92;
  const h = r * 1.82;
  ctx.beginPath();
  ctx.moveTo(cx - w, top);
  ctx.lineTo(cx + w, top);
  ctx.lineTo(cx + w, top + h * 0.42);
  ctx.quadraticCurveTo(cx + w, top + h * 0.82, cx, top + h);
  ctx.quadraticCurveTo(cx - w, top + h * 0.82, cx - w, top + h * 0.42);
  ctx.closePath();
  ctx.fill();
  // Cross knocked through it — upper crossbar, long stem below (right way up).
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = '#06070b';
  const bar = r * 0.2;
  ctx.fillRect(cx - bar / 2, top + h * 0.14, bar, h * 0.64);
  ctx.fillRect(cx - w * 0.6, top + h * 0.3, w * 1.2, bar);
  ctx.restore();
}

/** Stallion: the horse-head PROFILE drawn to real proportions — a LONG
 *  straight nasal bridge (the head is ~2.5x longer than it is deep), a soft
 *  rounded muzzle with a chin, the big round jowl at the back of the jaw,
 *  small close-set pricked ears and a notched mane crest down the nape. */
function drawStallion(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const x = (u: number): number => cx + u * r;
  const y = (v: number): number => cy + v * r;
  ctx.beginPath();
  // Nose tip (facing left): a soft roundover onto the nasal bridge…
  ctx.moveTo(x(-1.0), y(-0.08));
  ctx.quadraticCurveTo(x(-0.99), y(-0.24), x(-0.86), y(-0.32));
  // …then the LONG straight bridge up to the brow.
  ctx.lineTo(x(-0.14), y(-0.7));
  // Front ear, small and pricked, the valley, and the back ear.
  ctx.lineTo(x(-0.07), y(-0.72));
  ctx.lineTo(x(-0.02), y(-1.0));
  ctx.lineTo(x(0.11), y(-0.74));
  ctx.lineTo(x(0.23), y(-0.97));
  ctx.lineTo(x(0.3), y(-0.66));
  // The mane: a notched crest falling down the back of the neck.
  ctx.quadraticCurveTo(x(0.4), y(-0.56), x(0.42), y(-0.44));
  ctx.lineTo(x(0.55), y(-0.32));
  ctx.lineTo(x(0.5), y(-0.14));
  ctx.lineTo(x(0.66), y(-0.02));
  ctx.lineTo(x(0.6), y(0.2));
  ctx.lineTo(x(0.78), y(0.34));
  ctx.quadraticCurveTo(x(0.88), y(0.6), x(0.82), y(0.95));
  // Base of the neck.
  ctx.lineTo(x(-0.02), y(0.95));
  // Up the throatlatch in ONE clean sweep onto the lean jaw underline — the
  // old jowl-disc detour bulged like a lump in the throat at tile size.
  ctx.quadraticCurveTo(x(-0.2), y(0.62), x(-0.42), y(0.34));
  ctx.lineTo(x(-0.8), y(0.16));
  // Chin knob, lip notch, and the rounded nose closing to the tip.
  ctx.quadraticCurveTo(x(-0.9), y(0.16), x(-0.93), y(0.08));
  ctx.quadraticCurveTo(x(-1.03), y(0.02), x(-1.0), y(-0.08));
  ctx.closePath();
  ctx.fill();
  // Eye high under the brow + comma nostril knocked out darker.
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#06070b';
  ctx.beginPath();
  ctx.ellipse(x(-0.22), y(-0.5), r * 0.08, r * 0.065, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x(-0.87), y(-0.05), r * 0.045, r * 0.075, 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A platform's emblem: a little octagon pad in its colours (slab fill if it has
 *  a premium tint, else the neon), rimmed in the neon. */
export function drawPlatformIcon(ctx: CanvasRenderingContext2D, skin: PlatformSkin, cx: number, cy: number, r: number): void {
  const fill = skin.slab !== undefined ? skin.slab : skin.neon;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = hex(fill);
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.16);
  ctx.strokeStyle = hex(skin.neon);
  ctx.shadowColor = hex(skin.neon);
  ctx.shadowBlur = r * 0.5;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // The XD pad wears its grin even at thumbnail size.
  if (skin.id === 'xdface') {
    ctx.fillStyle = '#f4f6fb';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(r * 0.7)}px system-ui, sans-serif`;
    ctx.fillText('XD', cx, cy + r * 0.04);
  }
  // BLAZING wears its flame — the same leaning-tongue silhouette as the
  // leaderboard's blazing feat marker: an outer tongue in the pad's neon and
  // a hot amber core.
  if (skin.id === 'blazing') {
    const tongue = (h: number, colour: string): void => {
      const w = h * 0.62;
      const by = cy + r * 0.62; // flame base, tip reaching up
      ctx.beginPath();
      ctx.moveTo(cx, by);
      ctx.bezierCurveTo(cx - w * 0.55, by - h * 0.12, cx - w * 0.42, by - h * 0.55, cx - w * 0.1, by - h * 0.62);
      ctx.bezierCurveTo(cx - w * 0.28, by - h * 0.8, cx + w * 0.02, by - h * 0.9, cx + w * 0.08, by - h);
      ctx.bezierCurveTo(cx + w * 0.42, by - h * 0.68, cx + w * 0.55, by - h * 0.3, cx, by);
      ctx.closePath();
      ctx.fillStyle = colour;
      ctx.fill();
    };
    tongue(r * 1.3, hex(skin.neon));
    tongue(r * 0.72, '#ffb000');
  }
  // TIDEBREAKER wears GOOPLIATH's gel drop, dark-rimmed so it pops off the
  // bottle-green deck.
  if (skin.id === 'tidebreaker') {
    const d = r * 0.72;
    ctx.beginPath();
    ctx.moveTo(cx, cy - d);
    ctx.quadraticCurveTo(cx + 0.95 * d, cy + 0.1 * d, cx + 0.55 * d, cy + 0.55 * d);
    ctx.quadraticCurveTo(cx, cy + 0.98 * d, cx - 0.55 * d, cy + 0.55 * d);
    ctx.quadraticCurveTo(cx - 0.95 * d, cy + 0.1 * d, cx, cy - d);
    ctx.closePath();
    ctx.fillStyle = hex(skin.neon);
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.07);
    ctx.strokeStyle = 'rgba(6,20,12,0.8)';
    ctx.stroke();
  }
  // SYNTHWAVE wears its neon deck grid (clipped to the pad outline).
  if (skin.id === 'synthwave') {
    ctx.save();
    ctx.clip(); // the octagon path is still current
    ctx.strokeStyle = hex(skin.neon);
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) {
      const o = i * r * 0.36;
      ctx.moveTo(cx - r, cy + o);
      ctx.lineTo(cx + r, cy + o);
      ctx.moveTo(cx + o, cy - r);
      ctx.lineTo(cx + o, cy + r);
    }
    ctx.stroke();
    ctx.restore();
  }
  // The VOLT pad wears its lightning bolt.
  if (skin.id === 'volt') {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(0.35);
    ctx.beginPath();
    ctx.moveTo(r * 0.14, -r * 0.62);
    ctx.lineTo(-r * 0.2, r * 0.03);
    ctx.lineTo(r * 0.02, r * 0.03);
    ctx.lineTo(-r * 0.14, r * 0.62);
    ctx.lineTo(r * 0.2, -r * 0.09);
    ctx.lineTo(-r * 0.02, -r * 0.09);
    ctx.closePath();
    ctx.fillStyle = hex(skin.neon);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}
