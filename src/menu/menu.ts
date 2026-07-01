/**
 * The lobby: four smoked-steel plates in front of the player — industrial
 * robot-wars styling, translucent so your room stays visible through them.
 * Centre = AIM TRAINING (the tutorial mode), left = 1V1 (quick match + vs
 * bot), right = stats & connection info, and BELOW the tutorial panel the
 * ARCADE console — the five-titan campaign gauntlet — tilted up like a
 * control desk. Each panel is a canvas texture on a plane; MenuSystem
 * raycasts the controllers for hover + click and maps the hit UV to an
 * action zone.
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
import { app, stageUnlocked, training } from './appState.js';
import { GAME_TITLE } from '../config.js';
import { BOSSES } from '../campaign/bosses.js';
import { playerLevel } from '../combat/rewards.js';
import { UI, buttonPlate, hazardStrip, plate, stencilFont } from '../ui/industrial.js';

export type PanelId = 'train' | 'duel' | 'info' | 'arcade';

export type MenuAction =
  | 'start-training'
  | 'toggle-shootback'
  | 'quick-match'
  | 'cancel-queue'
  | 'vs-bot'
  | `campaign-${number}`;

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

/** Left — 1V1: quick match (or cancel) + vs bot. */
function drawDuel(ctx: CanvasRenderingContext2D, hover: boolean): void {
  panelBg(ctx, hover, UI.cool, '1 V 1');

  const queueing = app.state === 'queueing';
  buttonPlate(
    ctx, 70, 116, PW - 140, 96,
    queueing ? 'CANCEL' : 'QUICK MATCH',
    queueing ? UI.amber : UI.cool,
    hover,
  );
  buttonPlate(ctx, 70, 240, PW - 140, 96, 'VS BOT', UI.ember, hover);

  ctx.font = '600 22px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(159,226,255,0.85)';
  ctx.fillText(queueing ? 'searching for an opponent…' : app.netStatus, PW / 2, 352);
  ctx.fillStyle = UI.textDim;
  ctx.fillText('online duels carry positional voice chat', PW / 2, 380);
}

function hitDuel(_u: number, v: number): MenuAction | null {
  const y = (1 - v) * PH;
  if (y >= 108 && y <= 220) return app.state === 'queueing' ? 'cancel-queue' : 'quick-match';
  if (y >= 232 && y <= 344) return 'vs-bot';
  return null;
}

/**
 * Below the tutorial — ARCADE: the titan gauntlet. Five stage slots in a
 * row (cleared / open / locked), the next titan's name, and your wallet.
 */

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const SLOT_W = 76;
const SLOT_H = 104;
const SLOT_GAP = 9;
const SLOT_Y = 118;
const SLOTS_X = (PW - (SLOT_W * 5 + SLOT_GAP * 4)) / 2;

/** A simple stencil padlock for locked stages. */
function padlock(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.strokeStyle = UI.steelDim;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy - 8, 11, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = UI.steelDim;
  ctx.fillRect(cx - 15, cy - 8, 30, 24);
}

function drawArcade(ctx: CanvasRenderingContext2D, hover: boolean): void {
  panelBg(ctx, hover, UI.danger, 'ARCADE');
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = UI.textDim;
  ctx.fillText('the titan gauntlet', PW - 40, 44);
  ctx.textAlign = 'center';

  const cleared = app.stats.campaignCleared;
  for (let i = 0; i < 5; i++) {
    const x = SLOTS_X + i * (SLOT_W + SLOT_GAP);
    const done = cleared[i] === true;
    const open = stageUnlocked(i);
    plate(ctx, x, SLOT_Y, SLOT_W, SLOT_H, {
      cut: 10,
      fill: done ? 'rgba(255,122,24,0.2)' : open ? 'rgba(255,176,0,0.1)' : 'rgba(150,150,170,0.06)',
      stroke: done ? UI.ember : open ? UI.amber : UI.steelDim,
      rivets: false,
    });
    if (!open) {
      padlock(ctx, x + SLOT_W / 2, SLOT_Y + 46);
    } else {
      ctx.font = stencilFont(38);
      ctx.fillStyle = done ? UI.emberBright : UI.amber;
      ctx.fillText(ROMAN[i], x + SLOT_W / 2, SLOT_Y + 40);
      ctx.font = '700 20px system-ui, sans-serif';
      ctx.fillStyle = done ? UI.emberBright : UI.textDim;
      ctx.fillText(done ? 'FELLED' : 'FIGHT', x + SLOT_W / 2, SLOT_Y + 78);
    }
  }

  // Next opponent line: the first unfelled, unlocked titan.
  const next = BOSSES.findIndex((_, i) => stageUnlocked(i) && cleared[i] !== true);
  ctx.font = '700 24px system-ui, sans-serif';
  ctx.fillStyle = UI.amberSoft;
  ctx.fillText(
    next >= 0 ? `next: ${BOSSES[next].name} — ${BOSSES[next].epithet}` : 'all five titans felled',
    PW / 2,
    262,
  );
  ctx.font = '600 21px system-ui, sans-serif';
  ctx.fillStyle = UI.textDim;
  ctx.fillText('first fell pays double scrap & xp', PW / 2, 296);

  // Wallet readout.
  ctx.font = stencilFont(26);
  ctx.fillStyle = UI.text;
  ctx.fillText(
    `LV ${playerLevel(app.stats.xp)}  ·  ${app.stats.xp} XP  ·  ${app.stats.scrap} SCRAP`,
    PW / 2,
    348,
  );
}

function hitArcade(u: number, v: number): MenuAction | null {
  const x = u * PW;
  const y = (1 - v) * PH;
  if (y < SLOT_Y - 8 || y > SLOT_Y + SLOT_H + 8) return null;
  for (let i = 0; i < 5; i++) {
    const sx = SLOTS_X + i * (SLOT_W + SLOT_GAP);
    if (x >= sx && x <= sx + SLOT_W) {
      return stageUnlocked(i) ? (`campaign-${i}` as MenuAction) : null;
    }
  }
  return null;
}

/** Right — stats & how-to. Not clickable. */
function drawInfo(ctx: CanvasRenderingContext2D): void {
  panelBg(ctx, false, UI.text, GAME_TITLE);

  ctx.font = '600 26px system-ui, sans-serif';
  ctx.fillStyle = UI.amberSoft;
  const lines = [
    'hold trigger — ball orbits your fist',
    'punch + release — throw',
    'trigger — recall the ball',
    'a recall through them still hits',
    'your orbit parries their fire',
    'stay on your platform!',
  ];
  lines.forEach((l, i) => ctx.fillText(l, PW / 2, 108 + i * 38));

  ctx.font = '700 28px system-ui, sans-serif';
  ctx.fillStyle = UI.emberBright;
  ctx.fillText(
    `${app.stats.wins}W / ${app.stats.losses}L  ·  best ${app.stats.trainingBest}${training.lastScore ? `  ·  last ${training.lastScore}` : ''}`,
    PW / 2,
    342,
  );
  ctx.font = '700 26px system-ui, sans-serif';
  ctx.fillStyle = UI.amberSoft;
  ctx.fillText(
    `LV ${playerLevel(app.stats.xp)}  ·  ${app.stats.xp} XP  ·  ${app.stats.scrap} SCRAP`,
    PW / 2,
    380,
  );
}

export function createMenu(scene: Scene): Menu {
  const group = new Group();
  group.name = 'lobby-menu';

  const train = makePanel('train', 0.86, 0.68, drawTrain, hitTrain);
  const duel = makePanel('duel', 0.78, 0.62, drawDuel, hitDuel);
  const info = makePanel('info', 0.78, 0.62, (ctx) => drawInfo(ctx), () => null);
  const arcade = makePanel('arcade', 0.86, 0.66, drawArcade, hitArcade);

  // Shallow arc in front of the player, tilted inward toward the centre.
  const y = 1.45;
  train.mesh.position.set(0, y, -1.25);
  duel.mesh.position.set(-0.84, y - 0.02, -1.02);
  duel.mesh.rotation.y = 0.48;
  info.mesh.position.set(0.84, y - 0.02, -1.02);
  info.mesh.rotation.y = -0.48;
  // The arcade console sits BELOW the tutorial panel, leaned back like a
  // control desk so it reads comfortably from standing height.
  arcade.mesh.position.set(0, 0.78, -1.06);
  arcade.mesh.rotation.x = -0.38;

  const panels = [train, duel, info, arcade];
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
