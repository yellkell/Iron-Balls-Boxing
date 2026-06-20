/**
 * The lobby: three smoked-steel plates on a shallow arc in front of the
 * player — industrial robot-wars styling, translucent so your room stays
 * visible through them. Centre = AIM TRAINING (the headline mode), left =
 * 1V1 (quick match + vs bot), right = stats & connection info. Each panel is
 * a canvas texture on a plane; MenuSystem raycasts the controllers for
 * hover + click and maps the hit UV to an action zone.
 */

import {
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Scene,
} from 'three';
import { app } from './appState.js';
import { rankBadge } from './rankBadges.js';
import { GAME_TITLE } from '../config.js';
import { tierForXp } from '../progression/progression.js';
import { UI, buttonPlate, hazardStrip, plate, segmentBar, stencilFont } from '../ui/industrial.js';

export type PanelId = 'train' | 'duel' | 'info';

export type MenuAction =
  | 'start-training'
  | 'toggle-shootback'
  | 'quick-match'
  | 'ranked-match'
  | 'cancel-queue'
  | 'vs-bot';

const PW = 512;
const PH = 400;

export interface MenuPanel {
  id: PanelId;
  mesh: Mesh;
  redraw: (hover: boolean) => void;
  /** Map a hit UV (u right, v up) to an action, or null. */
  hitTest: (u: number, v: number) => MenuAction | null;
}

export interface Menu {
  group: Group;
  panels: MenuPanel[];
  setVisible: (v: boolean) => void;
  redrawAll: (hoverId: PanelId | null) => void;
}

/** The shared panel skeleton: smoked plate, hazard chip, stencil title. */
function panelBg(ctx: CanvasRenderingContext2D, hover: boolean, accent: string, title: string): void {
  ctx.clearRect(0, 0, PW, PH);
  plate(ctx, 8, 8, PW - 16, PH - 16, {
    cut: 26,
    fill: hover ? 'rgba(14,15,20,0.6)' : UI.ink,
    stroke: hover ? accent : UI.steel,
  });
  hazardStrip(ctx, 36, 34, 52, 16, UI.amber);
  ctx.textAlign = 'left';
  ctx.font = stencilFont(40);
  ctx.fillStyle = accent;
  ctx.fillText(title, 104, 44);
  ctx.strokeStyle = hover ? accent : UI.steelDim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(36, 72);
  ctx.lineTo(PW - 36, 72);
  ctx.stroke();
  ctx.textAlign = 'center';
}

function makePanel(
  id: PanelId,
  wMeters: number,
  hMeters: number,
  draw: (ctx: CanvasRenderingContext2D, hover: boolean) => void,
  hitTest: MenuPanel['hitTest'],
): MenuPanel {
  const canvas = document.createElement('canvas');
  canvas.width = PW;
  canvas.height = PH;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  const mesh = new Mesh(
    new PlaneGeometry(wMeters, hMeters),
    new MeshBasicMaterial({ map: texture, transparent: true }),
  );
  mesh.name = `menu-panel:${id}`;
  const redraw = (hover: boolean): void => {
    draw(ctx, hover);
    texture.needsUpdate = true;
  };
  return { id, mesh, redraw, hitTest };
}

/** Centre — AIM TRAINING: the big start plate + the shoot-back toggle. */
function drawTrain(ctx: CanvasRenderingContext2D, hover: boolean): void {
  panelBg(ctx, hover, UI.emberBright, 'AIM TRAINING');

  buttonPlate(ctx, 70, 120, PW - 140, 110, 'START', UI.ember, hover);

  // Shoot-back toggle row: an industrial breaker switch.
  const on = app.shootBack;
  ctx.font = '700 28px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = UI.textDim;
  ctx.fillText('targets shoot back', 64, 300);
  const pw = 120, ph = 56, px = PW - 64 - pw, py = 272;
  plate(ctx, px, py, pw, ph, {
    cut: 10,
    fill: on ? 'rgba(79,183,255,0.25)' : 'rgba(150,150,170,0.12)',
    stroke: on ? UI.cool : UI.steelDim,
    rivets: false,
  });
  ctx.fillStyle = on ? UI.cool : UI.steelDim;
  const kw = pw / 2 - 12;
  ctx.fillRect(on ? px + pw - kw - 8 : px + 8, py + 8, kw, ph - 16);

  ctx.textAlign = 'center';
  ctx.font = '600 24px system-ui, sans-serif';
  ctx.fillStyle = UI.amberSoft;
  ctx.fillText(`best score  ${app.stats.trainingBest}`, PW / 2, 360);
}

function hitTrain(_u: number, v: number): MenuAction | null {
  // v: 0 bottom → 1 top (canvas y = (1-v)*PH).
  const y = (1 - v) * PH;
  if (y >= 110 && y <= 245) return 'start-training';
  if (y >= 262 && y <= 340) return 'toggle-shootback';
  return null;
}

/** Left — 1V1: quick match, ranked match (or cancel) + vs bot. */
function drawDuel(ctx: CanvasRenderingContext2D, hover: boolean): void {
  panelBg(ctx, hover, UI.cool, '1 V 1');

  if (app.state === 'queueing') {
    buttonPlate(ctx, 70, 150, PW - 140, 92, 'CANCEL', UI.amber, hover);
    ctx.font = '600 24px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(159,226,255,0.85)';
    ctx.fillText(`searching — ${app.queueMode} match…`, PW / 2, 300);
    return;
  }

  buttonPlate(ctx, 64, 92, PW - 128, 76, 'QUICK MATCH', UI.cool, hover);
  buttonPlate(ctx, 64, 176, PW - 128, 76, 'RANKED', UI.amber, hover);
  buttonPlate(ctx, 64, 260, PW - 128, 72, 'VS BOT', UI.ember, hover);

  ctx.font = '600 21px system-ui, sans-serif';
  ctx.fillStyle = UI.textDim;
  ctx.fillText('ranked moves your ELO · quick is casual', PW / 2, 362);
  ctx.fillStyle = 'rgba(159,226,255,0.7)';
  ctx.font = '600 19px system-ui, sans-serif';
  ctx.fillText('online duels carry positional voice chat', PW / 2, 386);
}

function hitDuel(_u: number, v: number): MenuAction | null {
  const y = (1 - v) * PH;
  if (app.state === 'queueing') return y >= 140 && y <= 250 ? 'cancel-queue' : null;
  if (y >= 88 && y <= 172) return 'quick-match';
  if (y >= 172 && y <= 256) return 'ranked-match';
  if (y >= 256 && y <= 336) return 'vs-bot';
  return null;
}

/** Right — rank, stats & how-to. Not clickable. */
function drawInfo(ctx: CanvasRenderingContext2D): void {
  panelBg(ctx, false, UI.text, GAME_TITLE);

  // --- Bronze→Overlord rank badge + XP bar toward the next tier ---
  const tier = tierForXp(app.stats.xp);

  // The emblem art, left; its native dark backing reads as a metal plaque.
  const badge = rankBadge(tier.index);
  const bx = 38, by = 84, bh = 96, bw = badge ? (badge.naturalWidth / badge.naturalHeight) * bh : 84;
  if (badge) ctx.drawImage(badge, bx, by, bw, bh);
  const textX = bx + bw + 18;

  ctx.textAlign = 'left';
  ctx.font = stencilFont(30);
  ctx.fillStyle = UI.emberBright;
  ctx.fillText(tier.name, textX, 116);
  ctx.textAlign = 'right';
  ctx.font = '600 22px system-ui, sans-serif';
  ctx.fillStyle = UI.textDim;
  ctx.fillText(
    tier.next === null ? `${app.stats.xp} XP  ·  MAX` : `${app.stats.xp} / ${tier.next} XP`,
    PW - 38,
    116,
  );
  segmentBar(ctx, textX, 138, PW - 38 - textX, 18, tier.progress, UI.ember);

  ctx.strokeStyle = UI.steelDim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(36, 196);
  ctx.lineTo(PW - 36, 196);
  ctx.stroke();

  // --- controls (condensed) ---
  ctx.textAlign = 'center';
  ctx.font = '600 23px system-ui, sans-serif';
  ctx.fillStyle = UI.amberSoft;
  const lines = [
    'hold trigger — ball orbits your fist',
    'punch + release — throw',
    'trigger — recall the ball',
    'orbit parries · stay on your platform',
  ];
  lines.forEach((l, i) => ctx.fillText(l, PW / 2, 224 + i * 32));

  // --- footer: lifetime record, rating, and the last gains ---
  const elo = app.stats.placementsLeft > 0 ? `${app.stats.elo} ELO*` : `${app.stats.elo} ELO`;
  ctx.font = '700 25px system-ui, sans-serif';
  ctx.fillStyle = UI.emberBright;
  ctx.fillText(
    `${app.stats.wins}W / ${app.stats.losses}L  ·  ${elo}`,
    PW / 2,
    348,
  );
  const bits: string[] = [];
  if (app.lastXpGain > 0) bits.push(`+${app.lastXpGain} XP`);
  if (app.lastEloDelta !== 0) bits.push(`${app.lastEloDelta > 0 ? '+' : ''}${app.lastEloDelta} ELO`);
  if (bits.length) {
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.fillStyle = UI.cool;
    ctx.fillText(`${bits.join('   ')}  last bout`, PW / 2, 380);
  }
}

export function createMenu(scene: Scene): Menu {
  const group = new Group();
  group.name = 'lobby-menu';

  const train = makePanel('train', 0.86, 0.68, drawTrain, hitTrain);
  const duel = makePanel('duel', 0.78, 0.62, drawDuel, hitDuel);
  const info = makePanel('info', 0.78, 0.62, (ctx) => drawInfo(ctx), () => null);

  // Shallow arc in front of the player, tilted inward toward the centre.
  const y = 1.45;
  train.mesh.position.set(0, y, -1.25);
  duel.mesh.position.set(-0.84, y - 0.02, -1.02);
  duel.mesh.rotation.y = 0.48;
  info.mesh.position.set(0.84, y - 0.02, -1.02);
  info.mesh.rotation.y = -0.48;

  const panels = [train, duel, info];
  for (const p of panels) {
    p.redraw(false);
    group.add(p.mesh);
  }
  scene.add(group);

  return {
    group,
    panels,
    setVisible: (v) => {
      group.visible = v;
    },
    redrawAll: (hoverId) => {
      for (const p of panels) p.redraw(p.id === hoverId);
    },
  };
}
