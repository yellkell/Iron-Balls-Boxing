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
import { app, gauntletUnlocked, stageUnlocked, training } from './appState.js';
import { GAME_TITLE } from '../config.js';
import { BOSSES } from '../campaign/bosses.js';
import { fmtRunTime } from '../campaign/campaignState.js';
import { drawBossIcon } from '../campaign/icons.js';
import { playerLevel } from '../combat/rewards.js';
import { UI, buttonPlate, hazardStrip, plate, stencilFont } from '../ui/industrial.js';

export type PanelId = 'train' | 'duel' | 'info' | 'arcade' | 'campaign' | 'leaderboard';

export type MenuAction =
  | 'start-training'
  | 'toggle-shootback'
  | 'quick-match'
  | 'cancel-queue'
  | 'vs-bot'
  | 'open-campaign'
  | 'close-campaign'
  | 'toggle-platform'
  | 'campaign-speedrun'
  | 'campaign-hardcore'
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
  /** Show the right panels for `app.menuPage` (main arc vs campaign line-up). */
  syncPage: () => void;
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
  canvasW = PW,
  canvasH = PH,
): MenuPanel {
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
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
 * Below the tutorial — ARCADE: the door to the titan gauntlet. One big
 * CAMPAIGN plate that opens the boss line-up sub-menu, a teaser row of the
 * five titan icons showing your progress, and your wallet.
 */

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

/** A simple stencil padlock for locked stages. */
function padlock(ctx: CanvasRenderingContext2D, cx: number, cy: number, s = 1): void {
  ctx.strokeStyle = UI.steelDim;
  ctx.lineWidth = 5 * s;
  ctx.beginPath();
  ctx.arc(cx, cy - 8 * s, 11 * s, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = UI.steelDim;
  ctx.fillRect(cx - 15 * s, cy - 8 * s, 30 * s, 24 * s);
}

function drawArcade(ctx: CanvasRenderingContext2D, hover: boolean): void {
  panelBg(ctx, hover, UI.danger, 'ARCADE');
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = UI.textDim;
  ctx.fillText('the titan gauntlet', PW - 40, 44);
  ctx.textAlign = 'center';

  buttonPlate(ctx, 70, 104, PW - 140, 100, 'CAMPAIGN', UI.danger, hover);

  // Progress teaser: the five titan icons, lit as you fell them.
  const cleared = app.stats.campaignCleared;
  for (let i = 0; i < 5; i++) {
    const cx = PW / 2 + (i - 2) * 84;
    const cy = 258;
    const done = cleared[i] === true;
    const open = stageUnlocked(i);
    drawBossIcon(ctx, i, cx, cy, 26, done ? UI.emberBright : open ? UI.amberSoft : UI.steelDim);
    if (!open) padlock(ctx, cx, cy, 0.55);
  }

  ctx.font = '600 21px system-ui, sans-serif';
  ctx.fillStyle = UI.textDim;
  ctx.fillText('five titans · first fell pays double scrap & xp', PW / 2, 308);

  // Wallet readout.
  ctx.font = stencilFont(26);
  ctx.fillStyle = UI.text;
  ctx.fillText(
    `LV ${playerLevel(app.stats.xp)}  ·  ${app.stats.xp} XP  ·  ${app.stats.scrap} SCRAP`,
    PW / 2,
    352,
  );
}

function hitArcade(_u: number, v: number): MenuAction | null {
  const y = (1 - v) * PH;
  if (y >= 96 && y <= 240) return 'open-campaign';
  return null;
}

/**
 * The campaign sub-menu — the titan line-up. Five cards left to right (you
 * fight them in order): bespoke icon, name, FELLED / FIGHT / locked, with
 * chevrons marking the path. BACK returns to the main arc; the LOADOUT row
 * equips the CHAMPION platform once GOLIATH has been felled.
 */

const CW = 1024;
const CH = 480;
const CARD_W = 168;
const CARD_H = 252;
const CARD_GAP = 16;
const CARD_Y = 84;
const CARDS_X = (CW - (CARD_W * 5 + CARD_GAP * 4)) / 2;
const BACK_RECT = [40, 396, 170, 60] as const;
const LOADOUT_RECT = [560, 396, 424, 60] as const;

function accentCss(accent: number): string {
  return `#${accent.toString(16).padStart(6, '0')}`;
}

function drawCampaign(ctx: CanvasRenderingContext2D, hover: boolean): void {
  ctx.clearRect(0, 0, CW, CH);
  plate(ctx, 8, 8, CW - 16, CH - 16, {
    cut: 30,
    fill: hover ? 'rgba(14,15,20,0.62)' : UI.ink,
    stroke: hover ? UI.danger : UI.steel,
  });
  hazardStrip(ctx, 40, 34, 60, 18, UI.amber);
  ctx.textAlign = 'left';
  ctx.font = stencilFont(42);
  ctx.fillStyle = UI.danger;
  ctx.fillText('THE TITAN GAUNTLET', 118, 46);
  ctx.textAlign = 'right';
  ctx.font = '700 24px system-ui, sans-serif';
  ctx.fillStyle = UI.textDim;
  ctx.fillText('fight them in order · left to right', CW - 48, 46);
  ctx.textAlign = 'center';

  const cleared = app.stats.campaignCleared;
  for (let i = 0; i < 5; i++) {
    const x = CARDS_X + i * (CARD_W + CARD_GAP);
    const cx = x + CARD_W / 2;
    const done = cleared[i] === true;
    const open = stageUnlocked(i);
    const boss = BOSSES[i];
    const accent = accentCss(boss.accent);

    plate(ctx, x, CARD_Y, CARD_W, CARD_H, {
      cut: 14,
      fill: done ? 'rgba(255,122,24,0.14)' : open ? 'rgba(255,176,0,0.08)' : 'rgba(150,150,170,0.05)',
      stroke: done ? UI.ember : open ? accent : UI.steelDim,
      rivets: false,
    });

    ctx.font = stencilFont(24);
    ctx.fillStyle = open ? UI.textDim : UI.steelDim;
    ctx.fillText(ROMAN[i], cx, CARD_Y + 26);

    drawBossIcon(ctx, i, cx, CARD_Y + 106, 46, done ? UI.emberBright : open ? accent : UI.steelDim);
    if (!open) padlock(ctx, cx, CARD_Y + 106);

    ctx.font = stencilFont(19);
    ctx.fillStyle = open ? UI.text : UI.steelDim;
    ctx.fillText(open ? boss.name : 'SEALED', cx, CARD_Y + 186);

    ctx.font = '700 20px system-ui, sans-serif';
    if (done) {
      ctx.fillStyle = UI.emberBright;
      ctx.fillText('FELLED ✓', cx, CARD_Y + 224);
    } else if (open) {
      ctx.fillStyle = UI.amber;
      ctx.fillText('FIGHT', cx, CARD_Y + 224);
    } else {
      ctx.fillStyle = UI.steelDim;
      ctx.fillText('fell the last', cx, CARD_Y + 224);
    }

    // Path chevron toward the next card.
    if (i < 4) {
      ctx.fillStyle = cleared[i] ? UI.ember : UI.steelDim;
      const ax = x + CARD_W + CARD_GAP / 2;
      const ay = CARD_Y + 106;
      ctx.beginPath();
      ctx.moveTo(ax - 6, ay - 10);
      ctx.lineTo(ax + 6, ay);
      ctx.lineTo(ax - 6, ay + 10);
      ctx.closePath();
      ctx.fill();
    }
  }

  // BACK to the main arc.
  buttonPlate(ctx, BACK_RECT[0], BACK_RECT[1], BACK_RECT[2], BACK_RECT[3], '← BACK', UI.cool, hover);

  // Loadout: the champion platform reward lives here.
  const [lx, ly, lw, lh] = LOADOUT_RECT;
  if (app.stats.championPlatform) {
    const champ = app.stats.platformSkin === 'champion';
    plate(ctx, lx, ly, lw, lh, {
      cut: 12,
      fill: champ ? 'rgba(255,215,0,0.16)' : 'rgba(18,19,24,0.72)',
      stroke: champ ? '#ffd700' : UI.steel,
      rivets: false,
    });
    ctx.font = '700 24px system-ui, sans-serif';
    ctx.fillStyle = champ ? '#ffd700' : UI.textDim;
    ctx.fillText(`LOADOUT — PLATFORM: ${champ ? 'CHAMPION ★' : 'STANDARD'}`, lx + lw / 2, ly + lh / 2 + 1);
  } else {
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.fillStyle = UI.steelDim;
    ctx.fillText('fell GOLIATH to claim the CHAMPION platform', lx + lw / 2, ly + lh / 2 + 1);
  }
}

function hitCampaign(u: number, v: number): MenuAction | null {
  const x = u * CW;
  const y = (1 - v) * CH;
  if (x >= BACK_RECT[0] && x <= BACK_RECT[0] + BACK_RECT[2] && y >= BACK_RECT[1] - 6 && y <= BACK_RECT[1] + BACK_RECT[3] + 6) {
    return 'close-campaign';
  }
  if (
    app.stats.championPlatform &&
    x >= LOADOUT_RECT[0] && x <= LOADOUT_RECT[0] + LOADOUT_RECT[2] &&
    y >= LOADOUT_RECT[1] - 6 && y <= LOADOUT_RECT[1] + LOADOUT_RECT[3] + 6
  ) {
    return 'toggle-platform';
  }
  if (y >= CARD_Y - 6 && y <= CARD_Y + CARD_H + 6) {
    for (let i = 0; i < 5; i++) {
      const sx = CARDS_X + i * (CARD_W + CARD_GAP);
      if (x >= sx && x <= sx + CARD_W) {
        return stageUnlocked(i) ? (`campaign-${i}` as MenuAction) : null;
      }
    }
  }
  return null;
}

/**
 * The LEADERBOARD panel — flanks the titan line-up on the campaign page.
 * Best gauntlet-run clocks per mode, plus the plates that start a run:
 * SPEEDRUN opens once all five titans are felled; HARDCORE (no healing)
 * opens once you've completed your first gauntlet run.
 */

const LW = 512;
const LH = 560;
const SPEEDRUN_RECT = [56, 428, LW - 112, 54] as const;
const HARDCORE_RECT = [56, 494, LW - 112, 54] as const;

function timesSection(
  ctx: CanvasRenderingContext2D,
  title: string,
  times: number[],
  lockedText: string | null,
  y: number,
  accent: string,
): void {
  ctx.textAlign = 'left';
  ctx.font = stencilFont(28);
  ctx.fillStyle = accent;
  ctx.fillText(title, 56, y);
  ctx.font = '700 24px system-ui, sans-serif';
  if (lockedText) {
    ctx.fillStyle = UI.steelDim;
    ctx.fillText(lockedText, 56, y + 38);
    return;
  }
  if (times.length === 0) {
    ctx.fillStyle = UI.textDim;
    ctx.fillText('no times on the board yet', 56, y + 38);
    return;
  }
  times.slice(0, 4).forEach((t, i) => {
    ctx.fillStyle = i === 0 ? UI.emberBright : UI.textDim;
    ctx.fillText(`${i + 1}.`, 56, y + 38 + i * 32);
    ctx.fillText(fmtRunTime(t), 110, y + 38 + i * 32);
    if (i === 0) ctx.fillText('★', 240, y + 38);
  });
}

function drawLeaderboard(ctx: CanvasRenderingContext2D, hover: boolean): void {
  ctx.clearRect(0, 0, LW, LH);
  plate(ctx, 8, 8, LW - 16, LH - 16, {
    cut: 26,
    fill: hover ? 'rgba(14,15,20,0.6)' : UI.ink,
    stroke: hover ? UI.amber : UI.steel,
  });
  hazardStrip(ctx, 36, 34, 52, 16, UI.amber);
  ctx.textAlign = 'left';
  ctx.font = stencilFont(36);
  ctx.fillStyle = UI.amber;
  ctx.fillText('LEADERBOARD', 104, 44);
  ctx.strokeStyle = UI.steelDim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(36, 72);
  ctx.lineTo(LW - 36, 72);
  ctx.stroke();

  const gOpen = gauntletUnlocked();
  timesSection(
    ctx, 'GAUNTLET', app.stats.runTimesGauntlet,
    gOpen ? null : 'fell all five titans to unlock', 108, UI.emberBright,
  );
  timesSection(
    ctx, 'HARDCORE', app.stats.runTimesHardcore,
    app.stats.hardcoreUnlocked ? null : 'complete a gauntlet run to unlock', 282, UI.danger,
  );

  ctx.textAlign = 'center';
  buttonPlate(
    ctx, SPEEDRUN_RECT[0], SPEEDRUN_RECT[1], SPEEDRUN_RECT[2], SPEEDRUN_RECT[3],
    gOpen ? 'RUN THE GAUNTLET' : 'GAUNTLET SEALED',
    gOpen ? UI.emberBright : UI.steelDim, hover && gOpen,
  );
  buttonPlate(
    ctx, HARDCORE_RECT[0], HARDCORE_RECT[1], HARDCORE_RECT[2], HARDCORE_RECT[3],
    app.stats.hardcoreUnlocked ? 'HARDCORE' : 'HARDCORE SEALED',
    app.stats.hardcoreUnlocked ? UI.danger : UI.steelDim, hover && app.stats.hardcoreUnlocked,
  );
}

function hitLeaderboard(u: number, v: number): MenuAction | null {
  const x = u * LW;
  const y = (1 - v) * LH;
  const inRect = (r: readonly [number, number, number, number]): boolean =>
    x >= r[0] && x <= r[0] + r[2] && y >= r[1] - 5 && y <= r[1] + r[3] + 5;
  if (inRect(SPEEDRUN_RECT) && gauntletUnlocked()) return 'campaign-speedrun';
  if (inRect(HARDCORE_RECT) && app.stats.hardcoreUnlocked) return 'campaign-hardcore';
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
  const campaign = makePanel('campaign', 1.56, 0.73, drawCampaign, hitCampaign, CW, CH);
  const leaderboard = makePanel('leaderboard', 0.62, 0.68, drawLeaderboard, hitLeaderboard, LW, LH);

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
  // The campaign page: the line-up centre-left, the leaderboard flanking
  // right, angled inward like the info panel on the main arc.
  campaign.mesh.position.set(-0.28, 1.4, -1.3);
  leaderboard.mesh.position.set(0.95, 1.38, -1.04);
  leaderboard.mesh.rotation.y = -0.5;

  const mainPanels: PanelId[] = ['train', 'duel', 'info', 'arcade'];
  const campaignPanels: PanelId[] = ['campaign', 'leaderboard'];
  const panels = [train, duel, info, arcade, campaign, leaderboard];
  for (const p of panels) {
    p.redraw(false);
    group.add(p.mesh);
  }
  scene.add(group);

  const syncPage = (): void => {
    const onMain = app.menuPage === 'main';
    for (const p of panels) {
      p.mesh.visible = (onMain ? mainPanels : campaignPanels).includes(p.id);
    }
  };
  syncPage();

  return {
    group,
    panels,
    setVisible: (v) => {
      group.visible = v;
    },
    redrawAll: (hoverId) => {
      for (const p of panels) p.redraw(p.id === hoverId);
    },
    syncPage,
  };
}
