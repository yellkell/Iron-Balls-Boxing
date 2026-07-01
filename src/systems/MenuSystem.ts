/**
 * Drives the lobby: draws controller laser pointers, raycasts the menu
 * panels for hover/click, runs the actions (Aim Training, quick match,
 * vs bot, shoot-back toggle), and shows/hides the right scene pieces per
 * app state. During a bout or training the menu hides and the pointers
 * disappear — your hands are for punching.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import {
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Raycaster,
  SphereGeometry,
  Vector3,
  type Intersection,
} from 'three';
import { app, saveShootBack, saveStats, type AppState } from '../menu/appState.js';
import { createMenu, type Menu, type MenuAction, type PanelId } from '../menu/menu.js';
import { net } from '../net/client.js';
import * as sfx from '../audio/sfx.js';

const _origin = new Vector3();
const _dir = new Vector3();
const _end = new Vector3();

interface Pointer {
  line: Line;
  dot: Mesh;
}

export class MenuSystem extends createSystem({}) {
  private menu!: Menu;
  private ray = new Raycaster();
  private hovered: PanelId | null = null;
  private lastState: AppState | null = null;
  private lastPage: 'main' | 'campaign' | null = null;
  private pointers: Record<'left' | 'right', Pointer> = {} as Record<'left' | 'right', Pointer>;
  private redrawTimer = 0;

  init(): void {
    this.menu = createMenu(this.scene);
    this.pointers.left = this.makePointer();
    this.pointers.right = this.makePointer();
    this.applyState();
    this.syncPlatformSkin();
  }

  update(delta: number): void {
    if (app.state !== this.lastState) this.applyState();

    if (app.state === 'playing' || app.state === 'training') {
      this.hidePointers();
      return;
    }

    // Page flips (CampaignSystem sends you back to the line-up after a bout).
    if (app.menuPage !== this.lastPage) {
      this.lastPage = app.menuPage;
      this.menu.syncPage();
      this.menu.redrawAll(this.hovered);
    }

    // Lobby / queueing: hover + click the visible page's panels.
    let hover: PanelId | null = null;
    const meshes = this.menu.panels.filter((p) => p.mesh.visible).map((p) => p.mesh);
    for (const hand of ['left', 'right'] as const) {
      const hit = this.updatePointer(hand, meshes);
      if (!hit) continue;
      const panel = this.menu.panels.find((p) => p.mesh === hit.object);
      if (!panel) continue;
      hover = panel.id;
      if (hit.uv && this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) {
        const action = panel.hitTest(hit.uv.x, hit.uv.y);
        if (action) this.run(action);
      }
    }
    if (hover !== this.hovered) {
      this.hovered = hover;
      this.menu.redrawAll(hover);
    }

    // Periodic redraw so live text (queue status) stays fresh.
    this.redrawTimer -= delta;
    if (this.redrawTimer <= 0) {
      this.redrawTimer = 0.5;
      this.menu.redrawAll(this.hovered);
    }
  }

  private run(action: MenuAction): void {
    sfx.ensureAudio();
    sfx.uiClick();
    // Gauntlet runs — check BEFORE the numbered-stage prefix match below.
    if (action === 'campaign-speedrun' || action === 'campaign-hardcore') {
      app.mode = 'campaign';
      app.campaignMode = action === 'campaign-hardcore' ? 'hardcore' : 'gauntlet';
      app.campaignStage = 0;
      app.state = 'playing';
      this.applyState();
      return;
    }
    // ARCADE stage cards: a single titan bout (locked cards never hit-test).
    if (action.startsWith('campaign-')) {
      app.mode = 'campaign';
      app.campaignMode = 'single';
      app.campaignStage = Number(action.slice('campaign-'.length)) || 0;
      app.state = 'playing';
      this.applyState();
      return;
    }
    switch (action) {
      case 'start-training':
        app.state = 'training';
        break;
      case 'toggle-shootback':
        app.shootBack = !app.shootBack;
        saveShootBack();
        break;
      case 'open-campaign':
        app.menuPage = 'campaign';
        break;
      case 'close-campaign':
        app.menuPage = 'main';
        break;
      case 'toggle-platform':
        if (app.stats.championPlatform) {
          app.stats.platformSkin = app.stats.platformSkin === 'champion' ? 'standard' : 'champion';
          saveStats();
          this.syncPlatformSkin();
        }
        break;
      case 'quick-match':
        app.state = 'queueing';
        net.queue();
        break;
      case 'cancel-queue':
        net.cancel();
        app.state = 'menu';
        break;
      case 'vs-bot':
        app.mode = 'bot';
        app.state = 'playing';
        break;
    }
    this.applyState();
  }

  // --- controller pointers -------------------------------------------------

  private makePointer(): Pointer {
    const geo = new BufferGeometry().setFromPoints([new Vector3(), new Vector3(0, 0, -1)]);
    const line = new Line(geo, new LineBasicMaterial({ color: 0xffa03c, transparent: true, opacity: 0.85 }));
    line.name = 'menu-pointer';
    line.frustumCulled = false;
    const dot = new Mesh(new SphereGeometry(0.012, 12, 10), new MeshBasicMaterial({ color: 0xffc04d }));
    dot.visible = false;
    this.scene.add(line);
    this.scene.add(dot);
    return { line, dot };
  }

  /** Point the laser down the hand's ray, snap its end + dot to any hit. */
  private updatePointer(hand: 'left' | 'right', targets: Object3D[]): Intersection | undefined {
    const p = this.pointers[hand];
    const rayObj = this.world.playerSpaceEntities.raySpaces[hand]?.object3D;
    if (!rayObj) {
      p.line.visible = false;
      p.dot.visible = false;
      return undefined;
    }
    rayObj.getWorldPosition(_origin);
    rayObj.getWorldDirection(_dir).negate(); // ray space points down −Z
    this.ray.set(_origin, _dir);
    const hit = this.ray.intersectObjects(targets, false)[0];
    _end.copy(hit ? hit.point : _origin.clone().addScaledVector(_dir, 1.6));
    const pos = p.line.geometry.getAttribute('position');
    pos.setXYZ(0, _origin.x, _origin.y, _origin.z);
    pos.setXYZ(1, _end.x, _end.y, _end.z);
    pos.needsUpdate = true;
    p.line.visible = true;
    if (hit) {
      p.dot.position.copy(hit.point);
      p.dot.visible = true;
    } else {
      p.dot.visible = false;
    }
    return hit;
  }

  private hidePointers(): void {
    for (const hand of ['left', 'right'] as const) {
      this.pointers[hand].line.visible = false;
      this.pointers[hand].dot.visible = false;
    }
  }

  /** Stand on the platform skin your loadout says you've earned. */
  private syncPlatformSkin(): void {
    const champ = app.stats.platformSkin === 'champion' && app.stats.championPlatform;
    const standard = this.scene.getObjectByName('player-platform');
    const champion = this.scene.getObjectByName('player-platform-champion');
    if (standard) standard.visible = !champ;
    if (champion) champion.visible = champ;
  }

  // --- visibility per state --------------------------------------------------

  private applyState(): void {
    const inLobby = app.state === 'menu' || app.state === 'queueing';
    this.menu.setVisible(inLobby);
    this.syncPlatformSkin(); // the champion platform can be earned mid-session

    // The title banner shows only in the lobby.
    const banner = this.scene.getObjectByName('title-banner');
    if (banner) banner.visible = inLobby;
    // The opponent's platform reads as "occupied" only when fighting.
    const oppPlatform = this.scene.getObjectByName('opponent-platform');
    if (oppPlatform) oppPlatform.visible = app.state !== 'training';

    if (inLobby) this.menu.redrawAll(this.hovered);
    this.lastState = app.state;
  }
}
