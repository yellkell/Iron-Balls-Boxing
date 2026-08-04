/**
 * Drives the lobby: draws controller laser pointers, raycasts the menu
 * panels for hover/click, runs the actions (Aim Training, quick match,
 * vs bot, shoot-back toggle), and shows/hides the right scene pieces per
 * app state. During a bout or training the menu hides and the pointers
 * disappear — your hands are for punching.
 *
 * The A button summons a small waist-height action panel (A again dismisses
 * it): FORFEIT mid-training; at the end of a bout, RETURN — plus REMATCH in
 * online bouts, where the panel pops up by itself for the decision.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import {
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Raycaster,
  SphereGeometry,
  Vector3,
  type Intersection,
} from 'three';
import { app, DEFAULT_ACCENT_HUE, DEFAULT_ACCENT_LIGHT, saveAccentHue, saveAccentLight, saveDifficulty, saveEnvironment, saveOnlyBots, saveShootBack, type AppState, type ArcadeMode } from '../menu/appState.js';
import { bootIntroActive } from '../experience/introGate.js';
import { DIFFICULTY_ORDER, type Difficulty } from '../config.js';
import { difficultyUnlocked } from '../campaign/campaignState.js';
import {
  accentBarHue,
  accentBarLight,
  clearProfileKeyboardHint,
  colorBarHue,
  musicVolFromU,
  sfxVolFromU,
  clickBalls,
  colorBarLight,
  campaignModal,
  clearReportSent,
  setCreditsOpen,
  createActionPanel,
  createMenu,
  markReportSent,
  flashProfileKeyboardHint,
  profileHintActive,
  resetNewsScroll,
  scrollNews,
  tickCoinRollup,
  type ActionButton,
  type ActionPanel,
  type Menu,
  type MenuAction,
  type PanelId,
} from '../menu/menu.js';
import { createNameKeyboard, type NameKeyboard } from '../menu/keyboard.js';
import {
  avatarOwned,
  clearShopPreview,
  customization,
  myAvatarSkin,
  ownAvatar,
  ownPlatform,
  platformOwned,
  setAvatarColor,
  setAvatarLight,
  setAvatarSkin,
  setPlatformSkin,
  setShopPreview,
} from '../menu/customization.js';
import { canAfford, coins, spendCoins } from '../menu/wallet.js';
import { playCash, preloadCash } from '../audio/cash.js';
import { setMenuMusicActive, toggleMusicMuted } from '../audio/menuMusic.js';
import { setMusicVolume } from '../audio/musicVolume.js';
import { handoffToLobby } from '../audio/battleMusic.js';
import { startLobbyWatch, stopLobbyWatch } from '../net/lobbyWatch.js';
import { setVoiceEnabled, voiceEnabled } from '../audio/voicePref.js';
import { buildBoxer, setAvatarAccent, solveTorso, type BoxerRig } from '../avatar/boxer.js';
import {
  AVATAR_SKINS,
  OPPONENT_DEFAULT_PLATFORM,
  PLATFORM_SKINS,
  applyAvatarSkin,
  applyPlatformSkin,
  platformSkin,
  resolveAvatarSkin,
} from '../avatar/skins.js';
import { match } from '../combat/matchState.js';
import { applyArenaLayout, tintPlatform } from '../arena/arena.js';
import { mesh } from '../net/mesh.js';
import { UI } from '../ui/industrial.js';
import { net } from '../net/client.js';
import { startQueueWatch, stopQueueWatch } from '../net/queueWatch.js';
import { startRaidWatch, stopRaidWatch } from '../net/raidWatch.js';
import { startRankedWatch, stopRankedWatch } from '../net/rankedWatch.js';
import { startPubWatch, stopPubWatch } from '../net/pubWatch.js';
import { PUB_REGIONS } from '../pub/config.js';
import {
  boardScroll,
  hasCustomName,
  leaderboard,
  leaderboardRows,
  myNote,
  myStats,
  refreshLeaderboard,
  rival,
  sendReport,
  scrollLeaderboard,
  setLeaderboardTab,
  setPlayerName,
  setPlayerNote,
  setProfileView,
} from '../net/leaderboard.js';
import { gazette, markGazetteRead, refreshGazette } from '../net/gazette.js';
import { hueToColor, pubUrl, teamColor } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { requestClubEntry } from '../experience/clubNavigation.js';

const _origin = new Vector3();
const _dir = new Vector3();
const _end = new Vector3();
const _head = new Vector3();
const _fwd = new Vector3();
const BOARD_SCROLL_DEADZONE = 0.55;
const BOARD_SCROLL_INITIAL_REPEAT = 0.28;
const BOARD_SCROLL_REPEAT = 0.12;
/** Pixels of newspaper body scrolled per thumbstick step (~2.5 lines). */
const NEWS_SCROLL_STEP = 76;

/** Panels a fresh boxer may use BEFORE running the tutorial: read the paper,
 *  flip passthrough, tweak settings. Everything else — every fight, the
 *  loadout, the shop — clanks like sealed armour until the tutorial has been
 *  run once (app.tutorialDone; the tutorial button itself is always live). */
const PRE_TUTORIAL_PANELS = new Set<string>(['gazette', 'news', 'gear', 'settings']);

interface Pointer {
  line: Line;
  dot: Mesh;
}

export class MenuSystem extends createSystem({}) {
  private menu!: Menu;
  /** Last lobby-ness handed to the music (null = never) — see applyState(). */
  private musicInLobby: boolean | null = null;
  private ray = new Raycaster();
  private hovered: PanelId | null = null;
  private hoveredAction: MenuAction | null = null;
  private lastState: AppState | null = null;
  private pointers: Record<'left' | 'right', Pointer> = {} as Record<'left' | 'right', Pointer>;
  private redrawTimer = 0;
  /** Last customisation version the panels were drawn at — a chip pick or a
   *  colour-bar drag repaints them at once rather than on the 0.5 s tick. */
  private lastSkinDraw = 0;
  private panel!: ActionPanel;
  private panelKey = '';
  private wasMatchOver = false;
  /** FORFEIT tapped once — the button row shows ✕ / ✓ until answered. */
  private confirmForfeit = false;
  private keyboard!: NameKeyboard;
  /** The action waiting behind the name keyboard. */
  private kbPending: MenuAction | null = null;
  /** Whether the keyboard is editing your callsign or your profile note. */
  private kbMode: 'name' | 'note' | 'report' = 'name';
  private mirror?: { group: Group; rig: BoxerRig };
  private skinVersion = 0;
  /** The opponent pad is modelling a STORE platform try-on (needs restoring). */
  private oppPadPreviewed = false;
  private boardScrollCooldown = 0;
  private boardScrollDir = 0;
  private newsScrollCooldown = 0;
  private newsScrollDir = 0;
  private draggingHue = false;
  private accentHue = Number.NaN;
  private accentLight = Number.NaN;
  /** Cached red glow group behind the FIRE FIGHT banner (pulsed in the lobby). */
  private bannerGlow?: Group;
  /** Which hand+panel currently owns a slider scrub. A scrub may only START on
   *  a fresh trigger press over the track, so a trigger held from opening the
   *  panel (or clicking elsewhere) can't hijack a slider as the ray crosses it. */
  private sliderGrab: { hand: 'left' | 'right'; panel: PanelId } | null = null;
  /** Cached raycast target list — rebuilt only when panel visibility flips
   *  (modal open/close), not re-filtered/mapped every frame. */
  private rayTargets: Object3D[] = [];
  /** Reused intersect scratch so the two casts per frame allocate nothing. */
  private hits: Intersection[] = [];
  /** Snapshot of the live lobby data behind the freshness tick — the panels
   *  only repaint (canvas redraw + texture upload ×8) when one of these
   *  actually changed, not blindly twice a second. */
  private lastLive: unknown[] = [];
  /** Monotonic token for lobby-join attempts — see the lobby-join handler. */
  private lobbyJoinSeq = 0;

  /** Everything the lobby panels draw that can change WITHOUT a local click:
   *  network watches, fetches, the mesh lobby, the profile-hint timer. Click,
   *  hover, scroll and skin changes all repaint through their own paths. */
  private liveDirty(): boolean {
    const cur: unknown[] = [
      app.searching,
      app.netStatus,
      app.pubCount,
      // Fresh object every 8 s poll — stringify so identical counts don't repaint.
      JSON.stringify(app.pubRegionCounts),
      app.lobbyRooms,
      app.rankedRooms,
      app.raidsOpen, // the RAID button's live badge

      app.privateCode, // arrives async while hosting a private match
      leaderboard.ranked, // all boards are replaced together per fetch
      leaderboard.status,
      gazette.article,
      gazette.status,
      gazette.unread,
      mesh.joined,
      mesh.full,
      mesh.names.join('|'),
      coins.balance,
      profileHintActive(), // flips false when the hint expires — one repaint clears it
      app.accentHue, // sliders repaint partially while scrubbed; this settles the rest
      app.accentLight,
    ];
    const last = this.lastLive;
    let dirty = last.length !== cur.length;
    if (!dirty) {
      for (let i = 0; i < cur.length; i++) {
        if (cur[i] !== last[i]) {
          dirty = true;
          break;
        }
      }
    }
    this.lastLive = cur;
    return dirty;
  }

  init(): void {
    this.menu = createMenu(this.scene);
    this.panel = createActionPanel(this.scene);
    this.keyboard = createNameKeyboard(this.scene);
    this.pointers.left = this.makePointer();
    this.pointers.right = this.makePointer();
    preloadCash(); // the shop money sting, ready before the first buy

    this.applyState();
  }

  update(delta: number): void {
    if (app.state !== this.lastState) this.applyState();
    this.applyOwnSkins();
    this.pulseBannerGlow();

    // The BOOT INTRO owns the view: the lobby is live behind the black shade,
    // so without this the pointers sweep panels nobody can see — chirping the
    // hover zap through the whole sequence and able to click things blind.
    if (bootIntroActive()) {
      this.hidePointers();
      return;
    }

    if (app.state === 'training' || app.state === 'playing') {
      this.updateActionPanel();
      return;
    }

    // The name keyboard owns the pointers while it's up.
    if (this.keyboard.isOpen()) {
      this.updateKeyboard();
      return;
    }

    // ARCADE LOBBY lifecycle (2v2 / ffa / raid): the room list is only watched
    // while the browser face is up (and we're not already seated). Every mode
    // AUTO-LAUNCHES when the room fills — the HOST stamps the room doc's
    // `started` flag (single writer) and EVERYONE enters together off that
    // mirrored flag. FFA can also start short-handed via the START button
    // (handled in the action switch), which flips the same flag.
    const lm = app.lobbyMode;
    if (lm && app.lobbyView === 'browser' && !mesh.joined) {
      startLobbyWatch(lm, (rooms) => {
        app.lobbyRooms = rooms;
      });
    } else {
      stopLobbyWatch();
    }
    if (lm && mesh.joined && mesh.isHost() && mesh.full && !mesh.started) {
      mesh.startLobby(); // room full — go
    }
    if (lm && mesh.joined && mesh.started) {
      this.launchLobby();
      return;
    }

    // Customisation and the gazette are both modal: the lobby arc swaps out for
    // the open panel. The leaderboard ('board') hangs behind you — always up.
    // The shop is a sub-modal of customisation: while it's up the customise
    // plate (and its mirror/loadout) step aside for the shop face.
    const shopOpen = customization.open && customization.shopOpen;
    const modalCustom = customization.open && !shopOpen;
    const modalNews = app.gazetteOpen;
    const modalCampaign = app.campaignOpen;
    const modalLobby = app.lobbyMode !== null;
    const modalSettings = app.settingsOpen;
    let visChanged = this.rayTargets.length === 0; // first frame: build the list
    for (const p of this.menu.panels) {
      let show: boolean;
      switch (p.id) {
        case 'board':
          show = p.mesh.visible; // always up, hanging behind you
          break;
        case 'custom': // the LOCKER
        case 'balls':
          show = modalCustom;
          break;
        case 'shop':
          show = shopOpen;
          break;
        case 'news':
          show = modalNews;
          break;
        case 'campaign':
          show = modalCampaign;
          break;
        case 'lobby':
          show = modalLobby;
          break;
        case 'settings':
          show = modalSettings;
          break;
        default:
          // The arc (train/duel/info), the paper button AND the coin readout:
          // the lobby's face, gone while any modal is open.
          show = !customization.open && !modalNews && !modalCampaign && !modalLobby && !modalSettings;
          break;
      }
      if (p.mesh.visible !== show) {
        p.mesh.visible = show;
        visChanged = true;
        // A panel entering the screen repaints NOW with current data — the
        // freshness tick no longer paints unconditionally, so anything that
        // changed while it was hidden (redrawAll skips hidden panels) would
        // otherwise linger stale.
        if (show) p.redraw(null);
      }
    }
    // The mirror stands beside both the customise plate AND the shop, so avatar
    // changes preview live wherever you pick them.
    if (this.mirror) this.mirror.group.visible = customization.open;

    // Lobby / queueing: hover + click the panels.
    let hover: PanelId | null = null;
    let hoverAction: MenuAction | null = null;
    let boardPointed = false;
    let boardScrollAxis = 0;
    let newsPointed = false;
    let newsScrollAxis = 0;
    let dragged = false;
    let clicked = false;
    if (visChanged) this.rayTargets = this.menu.panels.filter((p) => p.mesh.visible).map((p) => p.mesh);
    for (const hand of ['left', 'right'] as const) {
      const hit = this.updatePointer(hand, this.rayTargets);
      if (!hit) continue;
      const panel = this.menu.panels.find((p) => p.mesh === hit.object);
      if (!panel) continue;
      if (panel.id === 'board') {
        boardPointed = true;
        const axis = this.input.xr.gamepads[hand]?.getAxesValues(InputComponent.Thumbstick)?.y ?? 0;
        if (Math.abs(axis) > Math.abs(boardScrollAxis)) boardScrollAxis = axis;
      }
      if (panel.id === 'news') {
        newsPointed = true;
        const axis = this.input.xr.gamepads[hand]?.getAxesValues(InputComponent.Thumbstick)?.y ?? 0;
        if (Math.abs(axis) > Math.abs(newsScrollAxis)) newsScrollAxis = axis;
      }
      const action = hit.uv ? panel.hitTest(hit.uv.x, hit.uv.y) : null;
      if (action || !hoverAction) {
        hover = panel.id;
        hoverAction = action;
      }
      const gp = this.input.xr.gamepads[hand];
      const held = gp?.getButtonPressed(InputComponent.Trigger) ?? false;
      const down = gp?.getButtonDown(InputComponent.Trigger) ?? false;
      // A scrub may only BEGIN on a fresh press over the track (`down`); once
      // grabbed it continues while held (`owns`), even as the ray wanders. This
      // stops a trigger still held from opening the panel — or from a click
      // elsewhere — from hijacking a slider the instant the ray sweeps over it.
      if (!held && this.sliderGrab?.hand === hand) this.sliderGrab = null;
      const owns = this.sliderGrab?.hand === hand && this.sliderGrab?.panel === panel.id;
      // Gate the drag branch on an ACTUAL track hit — a press off the track
      // (e.g. on the accent panel's DEFAULT button) then falls through to the
      // click/action branch below instead of being swallowed.
      if (hit.uv && panel.drag && (down || owns) && panel.drag(hit.uv.x, hit.uv.y)) {
        if (down) this.sliderGrab = { hand, panel: panel.id };
        dragged = true;
      } else if (hit.uv && action === 'av-color' && (down || owns)) {
        if (down) this.sliderGrab = { hand, panel: panel.id };
        // The hue bar is continuous: scrub the armour colour live while held.
        setAvatarColor(colorBarHue(hit.uv.x));
      } else if (hit.uv && action === 'av-light' && (down || owns)) {
        if (down) this.sliderGrab = { hand, panel: panel.id };
        setAvatarLight(colorBarLight(hit.uv.x)); // scrub the armour lightness live
      } else if (hit.uv && action === 'accent-color' && (down || owns)) {
        if (down) this.sliderGrab = { hand, panel: panel.id };
        app.accentHue = accentBarHue(hit.uv.x); // scrub the neon accent live
        saveAccentHue();
      } else if (hit.uv && action === 'accent-light' && (down || owns)) {
        if (down) this.sliderGrab = { hand, panel: panel.id };
        app.accentLight = accentBarLight(hit.uv.x);
        saveAccentLight();
      } else if (hit.uv && action === 'sfx-vol' && (down || owns)) {
        if (down) {
          this.sliderGrab = { hand, panel: panel.id };
          sfx.uiClick(); // a tick at the new level so the scrub is audible
        }
        sfx.setSfxVolume(sfxVolFromU(hit.uv.x)); // scrub the SFX volume live
        dragged = true;
      } else if (hit.uv && action === 'music-vol' && (down || owns)) {
        if (down) this.sliderGrab = { hand, panel: panel.id };
        setMusicVolume(musicVolFromU(hit.uv.x)); // scrub the music volume live
        dragged = true;
      } else if (hit.uv && down) {
        if (!app.tutorialDone && action !== 'start-tutorial' && !PRE_TUTORIAL_PANELS.has(panel.id)) {
          sfx.armorClank(); // sealed until the tutorial has been run once
        } else if (panel.click) {
          if (panel.click(hit.uv.x, hit.uv.y)) clicked = true;
        } else if (action) {
          this.run(action);
        }
      }
    }
    const boardScrolled = this.updateBoardScroll(boardPointed, boardScrollAxis, delta);
    const newsScrolled = this.updateNewsScroll(newsPointed, newsScrollAxis, delta);
    const skinChanged = customization.version !== this.lastSkinDraw;
    if (skinChanged) this.lastSkinDraw = customization.version;
    const hoverChanged = hover !== this.hovered || hoverAction !== this.hoveredAction;
    if (hoverChanged) {
      // Repaint ONLY the panels whose hover visuals actually changed — the
      // one the pointer left and the one it landed on. This used to be a
      // redrawAll: every hover flicker re-rasterized all eight-plus visible
      // canvases (news alone is 720×900) and re-uploaded megabytes of
      // texture in one frame — a guaranteed dropped frame on Quest, which
      // reads as "screen tearing" while the head is moving. Hover happens
      // whenever a hand drifts, so the menu stuttered near-constantly.
      const prev = this.hovered;
      this.hovered = hover;
      this.hoveredAction = hoverAction;
      for (const p of this.menu.panels) {
        if (!p.mesh.visible || (p.id !== prev && p.id !== hover)) continue;
        p.redraw(p.id === hover ? hoverAction : null);
      }
      if (hover) sfx.uiHover(); // soft laser zap as the pointer lands
    }
    // A scroll repaints its own page, nothing else.
    if (boardScrolled) this.redrawPanel('board');
    if (newsScrolled) this.redrawPanel('news');
    // A skin change can touch several faces (locker, shop, board avatar) —
    // it's a rare, single event, so the full repaint is fine. A slider scrub
    // bumps the version EVERY frame — the drag branch below repaints just the
    // locker faces instead.
    if (skinChanged && !dragged) this.menu.redrawAll(this.hovered, this.hoveredAction);

    // Self-contained panel click (e.g. the ball loadout tiles).
    if (clicked) {
      sfx.ensureAudio();
      sfx.uiClick();
      this.menu.redrawAll(this.hovered, this.hoveredAction);
    }

    // Live-update the accent slider; persist once the trigger is released.
    // While the scrub is held, only the LOCKER faces repaint per frame — the
    // board and the rest settle on the next freshness tick after release.
    if (dragged) {
      this.draggingHue = true;
      for (const p of this.menu.panels) {
        if (!p.mesh.visible) continue;
        if (p.id === 'custom' || p.id === 'balls' || p.id === 'shop' || p.id === this.sliderGrab?.panel) {
          p.redraw(p.id === this.hovered ? this.hoveredAction : null);
        }
      }
    } else if (this.draggingHue) {
      this.draggingHue = false;
      saveAccentHue();
    }

    // Freshness tick for live text (queue status, pub counts, room lists…):
    // check the live data every 0.5 s but repaint ONLY when something changed.
    // An idle lobby uploads no panel textures at all.
    this.redrawTimer -= delta;
    if (this.redrawTimer <= 0) {
      this.redrawTimer = 0.5;
      if (this.liveDirty()) this.menu.redrawAll(this.hovered, this.hoveredAction);
    }

    // Coins banked during a bout roll up the moment you're back at the menu —
    // redraw just the readout each frame while the digits are still climbing.
    if (tickCoinRollup(delta)) {
      this.menu.panels.find((p) => p.id === 'coins')?.redraw(null);
    }

    // Pre-tutorial, the TUTORIAL plate breathes — repaint just the ARCADE
    // panel each frame so the pulse animates. Ends for good once completed.
    if (!app.tutorialDone) {
      const train = this.menu.panels.find((p) => p.id === 'train');
      if (train?.mesh.visible) train.redraw(this.hovered === 'train' ? this.hoveredAction : null);
    }
  }

  /** Repaint one panel by id, preserving its live hover highlight. */
  private redrawPanel(id: PanelId): void {
    this.menu.panels.find((p) => p.id === id)?.redraw(this.hovered === id ? this.hoveredAction : null);
  }

  private updateBoardScroll(pointing: boolean, axisY: number, delta: number): boolean {
    this.boardScrollCooldown = Math.max(0, this.boardScrollCooldown - delta);
    if (!pointing || Math.abs(axisY) < BOARD_SCROLL_DEADZONE) {
      this.boardScrollCooldown = 0;
      this.boardScrollDir = 0;
      return false;
    }

    const dir = axisY > 0 ? 1 : -1;
    const changedDir = dir !== this.boardScrollDir;
    if (!changedDir && this.boardScrollCooldown > 0) return false;

    this.boardScrollDir = dir;
    this.boardScrollCooldown = changedDir ? BOARD_SCROLL_INITIAL_REPEAT : BOARD_SCROLL_REPEAT;
    return scrollLeaderboard(dir);
  }

  /** The newspaper body scrolls the same way as the leaderboard — stepped
   *  thumbstick with a repeat cooldown — but in pixels rather than rows. */
  private updateNewsScroll(pointing: boolean, axisY: number, delta: number): boolean {
    this.newsScrollCooldown = Math.max(0, this.newsScrollCooldown - delta);
    if (!pointing || Math.abs(axisY) < BOARD_SCROLL_DEADZONE) {
      this.newsScrollCooldown = 0;
      this.newsScrollDir = 0;
      return false;
    }

    const dir = axisY > 0 ? 1 : -1;
    const changedDir = dir !== this.newsScrollDir;
    if (!changedDir && this.newsScrollCooldown > 0) return false;

    this.newsScrollDir = dir;
    this.newsScrollCooldown = changedDir ? BOARD_SCROLL_INITIAL_REPEAT : BOARD_SCROLL_REPEAT;
    return scrollNews(dir * NEWS_SCROLL_STEP);
  }

  private run(action: MenuAction): void {
    sfx.ensureAudio();
    sfx.uiClick();
    // The first leaderboard-relevant act (a training run, a 1v1 queue, or a
    // bot bout — bot wins score now too) claims a callsign: the keyboard pops
    // once, prefilled with the auto name, and the pending action resumes after
    // OK. Saved forever after, shared by both boards.
    if (
      (action === 'start-training' ||
        action === 'quick-match' ||
        action === 'ranked-host' ||
        action.startsWith('ranked-join-') ||
        action === 'lobby-host' ||
        action === 'lobby-vsbots' ||
        action.startsWith('lobby-join-')) &&
      !hasCustomName()
    ) {
      this.kbPending = action;
      this.kbMode = 'name';
      this.keyboard.open(myStats().name);
      return;
    }
    switch (action) {
      case 'start-tutorial':
        // The guided basics: a normal vs-bot duel that TutorialSystem paces
        // with pop-ups and a half-health bot. No callsign needed first.
        app.tutorial = true;
        app.arcade = '1v1';
        app.quickDuel = false; // ranked / private keep best of five
        app.mode = 'bot';
        app.state = 'playing';
        app.quickDuel = false; // the graduation bout keeps the standard format
        break;
      case 'start-training':
        app.arcade = '1v1';
        app.state = 'training';
        break;
      case 'open-campaign':
        app.campaignOpen = true;
        break;
      case 'campaign-close':
        app.campaignOpen = false;
        campaignModal.pending = null; // never reopen onto a stale pop-up
        break;
      case 'open-raid':
        // Rejoining the modal mid-lobby (e.g. after a look around) lands you
        // back in your squad room, not the browser.
        this.openLobby('raid');
        break;
      case 'arcade-2v2':
        // The BATTLE panel's 2V2 button now opens the shared lobby modal (make
        // a room, join one, or drop onto bots). ONLY PLAY BOTS shortcuts
        // straight to a bot brawl since online play is off.
        if (app.onlyBots) this.startBotBrawl('2v2');
        else this.openLobby('2v2');
        break;
      case 'arcade-ffa':
        if (app.onlyBots) this.startBotBrawl('ffa');
        else this.openLobby('ffa');
        break;
      case 'lobby-close':
        // Closing the modal is leaving the queue outright — no ghost seats
        // holding lobbies open for squads that wandered off.
        app.lobbyMode = null;
        app.lobbyView = 'browser';
        app.privateCode = ''; // a coded room is spent the moment you walk out
        mesh.cancel();
        break;
      case 'lobby-host':
        if (app.onlyBots || !app.lobbyMode) break; // lobbies are online affairs
        app.lobbyView = 'lobby';
        void mesh.hostLobby(app.lobbyMode, myStats().name, (s) => (app.netStatus = s));
        break;
      case 'lobby-vsbots':
        // Skip the lobby entirely — a pure bot brawl of the open mode.
        if (app.lobbyMode && app.lobbyMode !== 'raid') this.startBotBrawl(app.lobbyMode);
        break;
      case 'lobby-hardcore':
        if (mesh.isHost()) mesh.setRaidHardcore(!mesh.raidHardcore);
        break;
      case 'lobby-goopliath':
        if (mesh.isHost()) mesh.setRaidGoopliath(!mesh.raidGoopliath);
        break;
      case 'lobby-start':
        // FFA host launching short-handed — flip the room's started flag; the
        // lifecycle block above carries everyone (host + guests) into the bout.
        if (mesh.isHost()) mesh.startLobby();
        break;
      case 'lobby-leave':
        mesh.cancel();
        app.lobbyView = 'browser';
        app.privateCode = '';
        break;
      case 'campaign-speedrun':
      case 'campaign-hardcore':
        // The timed runs arm the pick-your-damage pop-up instead of firing
        // straight away — START launches, CANCEL (or any stray click) closes.
        campaignModal.pending = action === 'campaign-hardcore' ? 'hardcore' : 'gauntlet';
        break;
      case 'campaign-launch-cancel':
        campaignModal.pending = null;
        break;
      case 'campaign-launch-start': {
        // Launch the armed fight (a run from stage I, or the goop) at the
        // difficulty the pop-up's chips picked (diff-<tier> saved it).
        const kind = campaignModal.pending;
        campaignModal.pending = null;
        if (!kind) break;
        app.mode = 'campaign';
        app.campaignMode = kind;
        app.campaignStage = 0;
        app.arcade = '1v1';
        app.state = 'playing';
        break;
      }
      case 'campaign-goopliath':
        // The sealed entry beneath the line-up: GOOPLIATH's own single, very
        // long fight — arms the same pick-your-damage pop-up as the runs.
        campaignModal.pending = 'goopliath';
        break;
      case 'toggle-shootback':
        app.shootBack = !app.shootBack;
        saveShootBack();
        break;
      case 'toggle-onlybots':
        app.onlyBots = !app.onlyBots;
        saveOnlyBots();
        break;
      case 'toggle-voice':
        // Lives in the settings modal now — flip it and repaint that breaker.
        setVoiceEnabled(!voiceEnabled());
        this.menu.panels.find((p) => p.id === 'settings')?.redraw(null);
        break;
      case 'ranked-match':
        if (app.onlyBots) break; // disabled — no online play in only-bots mode
        // RANKED now opens the server browser: host your own room or join a
        // listed one. applyState() starts the room-list watch.
        app.arcade = '1v1';
        app.quickDuel = false; // ranked / private keep best of five
        app.duelView = 'browser';
        app.fromRanked = false;
        break;
      case 'ranked-host':
        if (app.onlyBots) break;
        // Open a public room named after you and wait — you STAY on the server
        // list, with your own room shown in it (unclickable).
        app.arcade = '1v1';
        app.quickDuel = false; // ranked / private keep best of five
        app.duelView = 'browser';
        app.rankedHost = true;
        app.fromRanked = true;
        app.state = 'queueing';
        net.hostRanked(myStats().name);
        break;
      case 'ranked-back':
        net.cancel();
        app.duelView = 'root';
        app.fromRanked = false;
        break;
      case 'ranked-cancel':
        // Bail out of a host/join and drop back onto the server list.
        net.cancel();
        app.state = 'menu';
        app.duelView = 'browser';
        break;
      case 'quick-match':
        // Drop straight onto a bot. Normally we keep hunting for a human in the
        // background (swap to the live bout if one turns up) — but ONLY PLAY BOTS
        // skips that, so it stays a pure bot bout.
        app.arcade = '1v1';
        app.quickDuel = true; // quick match runs best of three
        app.mode = 'bot';
        app.state = 'playing';
        // net.queue() sets this too, but ONLY PLAY BOTS never queues — and a
        // quick match against the bot is still a quick match, so it is still
        // best of three.
        app.quickDuel = true;
        if (!app.onlyBots) net.queue();
        break;
      case 'cancel-queue':
        net.cancel();
        // A private BRAWL is being reserved on the MESH, not the duel transport,
        // so net.cancel() alone would leave the room behind holding a code
        // nobody is ever going to use. Narrow on purpose: this is only the
        // private 2v2/FFA hosting face, never a live arcade lobby.
        if (app.duelView === 'hosting' && app.privateMode !== '1v1') {
          mesh.cancel();
          app.privateCode = '';
        }
        app.state = 'menu';
        app.duelView = 'root';
        app.codeEntry = '';
        break;
      case 'private-open':
        app.quickDuel = false; // ranked / private keep best of five
        app.duelView = 'private';
        break;
      case 'private-mode-1v1':
        app.privateMode = '1v1';
        break;
      case 'private-mode-2v2':
        app.privateMode = '2v2';
        break;
      case 'private-mode-ffa':
        app.privateMode = 'ffa';
        break;
      case 'private-create':
        app.duelView = 'hosting';
        app.privateCode = '';
        app.state = 'queueing';
        // 1V1 is the ordinary duel over the 1v1 transport, untouched. 2V2 and
        // FFA need four seats, which is the arcade MESH's job — so those open a
        // coded mesh room and hand over to the normal lobby lifecycle.
        if (app.privateMode === '1v1') net.createPrivate();
        else this.hostPrivateBrawl(app.privateMode);
        break;
      case 'private-enter':
        app.duelView = 'keypad';
        app.codeEntry = '';
        break;
      case 'private-back':
        net.cancel();
        app.duelView = 'root';
        app.codeEntry = '';
        break;
      case 'kp-del':
        app.codeEntry = app.codeEntry.slice(0, -1);
        break;
      case 'kp-join':
        if (app.codeEntry.length === 5) {
          app.state = 'queueing';
          this.joinByCode(app.codeEntry);
        }
        break;
      case 'env-desert':
        app.environment = 'desert';
        saveEnvironment();
        this.restartForEnvironmentMode();
        break;
      case 'env-saltflats':
        app.environment = 'saltflats';
        saveEnvironment();
        this.restartForEnvironmentMode();
        break;
      case 'env-factory':
        app.environment = 'factory';
        saveEnvironment();
        this.restartForEnvironmentMode();
        break;
      case 'lb-battle':
        // The BATTLE tab opens onto 1V1 unless a brawl board is already showing.
        setLeaderboardTab(
          leaderboard.tab === 'duo' || leaderboard.tab === 'ffa' ? leaderboard.tab : 'ranked',
        );
        break;
      case 'lb-ranked':
        setLeaderboardTab('ranked');
        break;
      case 'lb-xp':
        setLeaderboardTab('xp');
        break;
      case 'lb-arcade': {
        // ARCADE opens onto its currently-showing sub-board, else AIM.
        const arcadeSubs = ['training', 'gauntlet', 'raid', 'goopliath'] as const;
        setLeaderboardTab(
          (arcadeSubs as readonly string[]).includes(leaderboard.tab) ? leaderboard.tab : 'training',
        );
        break;
      }
      case 'lb-training':
        setLeaderboardTab('training');
        break;
      case 'lb-gauntlet':
        setLeaderboardTab('gauntlet');
        break;
      case 'lb-raid':
        setLeaderboardTab('raid');
        break;
      case 'lb-goopliath':
        setLeaderboardTab('goopliath');
        break;
      case 'lb-duo':
        setLeaderboardTab('duo');
        break;
      case 'lb-ffa':
        setLeaderboardTab('ffa');
        break;
      case 'lb-profile':
        setProfileView(null); // your own profile
        break;
      case 'profile-back':
        setLeaderboardTab('ranked');
        break;
      case 'edit-note':
        this.kbPending = null;
        this.kbMode = 'note';
        flashProfileKeyboardHint();
        this.menu.redrawAll(this.hovered, this.hoveredAction);
        this.keyboard.open(myNote(), 'ENTER NOTE', 48); // matches setPlayerNote's cap
        return;
      case 'rename':
        this.kbPending = null;
        this.kbMode = 'name';
        this.keyboard.open(myStats().name);
        return;
      case 'open-gazette':
        // Open the paper, and the moment you do the edition counts as read —
        // the red dot clears.
        app.gazetteOpen = true;
        resetNewsScroll();
        markGazetteRead();
        void refreshGazette(true);
        break;
      case 'gazette-close':
        app.gazetteOpen = false;
        break;
      case 'open-settings':
        app.settingsOpen = true;
        break;
      case 'settings-credits':
        setCreditsOpen(true);
        this.menu.panels.find((p) => p.id === 'settings')?.redraw(null);
        break;
      case 'credits-back':
        setCreditsOpen(false);
        this.menu.panels.find((p) => p.id === 'settings')?.redraw(null);
        break;
      case 'settings-close':
        app.settingsOpen = false;
        clearReportSent(); // next visit gets a fresh report button
        setCreditsOpen(false); // reopening lands on settings, not credits
        // Repaint the gear disc so its muted-pip reflects any change made inside.
        this.menu.panels.find((p) => p.id === 'gear')?.redraw(null);
        break;
      case 'settings-report':
        // The safety report: typed on the callsign keyboard, filed to the
        // backend (net/leaderboard sendReport) — the reporter never sees an
        // address and never leaves the game.
        this.kbMode = 'report';
        this.keyboard.open('', 'REPORT A PLAYER OR PROBLEM', 64);
        break;
      case 'toggle-mute':
        // Flip the music mute (persisted) and repaint the settings breaker.
        toggleMusicMuted();
        this.menu.panels.find((p) => p.id === 'settings')?.redraw(null);
        break;
      case 'open-pub':
        // Don't navigate yet — open the EU/USA region picker first.
        app.infoView = 'pubpick';
        break;
      case 'pub-back':
        app.infoView = 'root';
        break;
      case 'open-custom':
        // Opens onto the LOCKER (your inventory + colours).
        customization.open = true;
        customization.shopOpen = false;
        this.ensureMirror();
        break;
      case 'custom-close':
        customization.open = false;
        customization.shopOpen = false;
        clearShopPreview(); // the try-on goes back on the rack
        break;
      case 'open-shop':
        customization.shopOpen = true;
        break;
      case 'open-locker':
        customization.shopOpen = false;
        clearShopPreview();
        break;
      case 'tab-avatars':
        customization.tab = 'avatars';
        break;
      case 'tab-platforms':
        customization.tab = 'platforms';
        break;
      case 'tab-colour':
        customization.tab = 'colour';
        break;
      case 'tab-arena':
        customization.tab = 'arena';
        break;
      case 'av-uncolor':
        setAvatarColor(-1); // back to the skin's own palette
        break;
      case 'accent-default':
        app.accentHue = DEFAULT_ACCENT_HUE; // neon back to the house ember
        app.accentLight = DEFAULT_ACCENT_LIGHT;
        saveAccentHue();
        saveAccentLight();
        break;
      default:
        // diff-<tier>: the campaign difficulty picker sets the run difficulty
        // (persisted). raiddiff-<tier>: the raid host mirrors it to the squad.
        // hitTest only returns unlocked tiers, so no re-check is needed.
        if (action.startsWith('raiddiff-')) {
          const tier = action.slice('raiddiff-'.length) as Difficulty;
          if (mesh.isHost() && (DIFFICULTY_ORDER as string[]).includes(tier)) mesh.setRaidDifficulty(tier);
          break;
        }
        if (action.startsWith('diff-')) {
          const tier = action.slice('diff-'.length) as Difficulty;
          if ((DIFFICULTY_ORDER as string[]).includes(tier) && difficultyUnlocked(tier)) {
            app.difficulty = tier;
            saveDifficulty();
          }
          break;
        }
        // campaign-N: a single titan bout at stage N (sealed cards never
        // hit-test, so any N that lands here is unlocked).
        if (action.startsWith('campaign-')) {
          app.mode = 'campaign';
          app.campaignMode = 'single';
          app.campaignStage = Number(action.slice('campaign-'.length)) || 0;
          app.arcade = '1v1';
          app.state = 'playing';
          break;
        }
        // shop-buy-av-N / shop-buy-pf-N: the BUY button on a previewed STORE
        // tile — the actual purchase.
        if (action.startsWith('shop-buy-av-')) {
          const skin = AVATAR_SKINS[Number(action.slice('shop-buy-av-'.length))];
          if (skin && !skin.locked && !avatarOwned(skin.id)) {
            this.buyOrEquipAvatar(skin.id, skin.price ?? 0);
            if (avatarOwned(skin.id)) clearShopPreview(); // bought — it's really yours now
          }
          break;
        }
        if (action.startsWith('shop-buy-pf-')) {
          const skin = PLATFORM_SKINS[Number(action.slice('shop-buy-pf-'.length))];
          if (skin && !skin.earnedBy && !platformOwned(skin.id)) {
            this.buyOrEquipPlatform(skin.id, skin.price ?? 0);
            if (platformOwned(skin.id)) clearShopPreview();
          }
          break;
        }
        // shop-av-N / shop-pf-N: a LOCKER tap equips what you own; a STORE tap
        // on an unowned skin TRIES IT ON — the mirror (or your pad) models it
        // and the tile grows its BUY button. Nothing is spent on a tap.
        if (action.startsWith('shop-av-')) {
          const skin = AVATAR_SKINS[Number(action.slice(8))];
          if (!skin || skin.locked) break;
          if (customization.shopOpen && !avatarOwned(skin.id)) setShopPreview('avatar', skin.id);
          else this.buyOrEquipAvatar(skin.id, skin.price ?? 0);
          break;
        }
        if (action.startsWith('shop-pf-')) {
          const skin = PLATFORM_SKINS[Number(action.slice(8))];
          if (!skin) break;
          if (customization.shopOpen && !platformOwned(skin.id)) {
            // Even the earned-only CHAMPION pad can be tried on — its tile
            // just never grows a BUY button (the campaign awards it).
            setShopPreview('platform', skin.id);
          } else if (!skin.earnedBy || platformOwned(skin.id)) {
            this.buyOrEquipPlatform(skin.id, skin.price ?? 0);
          }
          break;
        }
        // kp-0 … kp-9: append a digit (max five) on the join keypad.
        if (action.startsWith('kp-') && app.codeEntry.length < 5) {
          const d = action.slice(3);
          if (d >= '0' && d <= '9') app.codeEntry += d;
        } else if (action.startsWith('lb-row-')) {
          // Open the clicked player's profile.
          const row = leaderboardRows()[boardScroll() + Number(action.slice(7))];
          if (row) setProfileView(row);
        } else if (action.startsWith('pub-go-')) {
          // Pick a pub region, remember it, then hop to the pub page.
          const id = action.slice(7);
          const region = PUB_REGIONS.find((r) => r.id === id);
          if (region) {
            localStorage.setItem('ibb-pub-server', region.url);
            app.infoView = 'root';
            this.gotoPub();
          }
        } else if (action.startsWith('ranked-join-')) {
          // Join a listed ranked room by its doc id (stay on the list, showing
          // a brief "joining…" while we connect).
          app.arcade = '1v1';
          app.quickDuel = false; // ranked / private keep best of five
          app.duelView = 'browser';
          app.rankedHost = false;
          app.fromRanked = true;
          app.state = 'queueing';
          net.joinRanked(action.slice('ranked-join-'.length));
        } else if (action.startsWith('lobby-join-')) {
          // Claim a seat in a listed lobby; a race with a final joiner drops
          // you back on the (fresh) list. The lobby view opens ONLY once the
          // claim actually lands: entering it optimistically stranded players
          // in a nameless empty room whenever the claim hung or the network
          // died mid-join (a wedged Quest write stream does exactly this) —
          // "it put me in the lobby but there are no names, not even mine".
          if (!app.onlyBots && app.lobbyMode) {
            const roomId = action.slice('lobby-join-'.length);
            app.netStatus = 'joining the lobby…';
            // Token so a second click while this claim is in flight makes this
            // one a bystander — mesh.joinLobby close()s the older attempt
            // itself, and a stale handler must not cancel() the newer one.
            const seq = ++this.lobbyJoinSeq;
            const attempt = mesh.joinLobby(app.lobbyMode, roomId, myStats().name, (s) => (app.netStatus = s));
            const timeout = new Promise<false>((resolve) =>
              setTimeout(() => resolve(false), 15_000),
            );
            const failed = (): void => {
              if (seq !== this.lobbyJoinSeq) return; // a newer attempt owns the mesh
              mesh.cancel(); // a late success must still free the seat
              app.lobbyView = 'browser';
              app.netStatus = 'could not join, try again';
            };
            void Promise.race([attempt, timeout])
              .then((ok) => {
                if (seq !== this.lobbyJoinSeq) return;
                if (ok) app.lobbyView = 'lobby';
                else failed(); // hung, refused, or lost the race for the seat
              })
              .catch(failed);
          }
        }
        break;
    }
    this.applyState();
  }

  /**
   * Shop tap on a platform tile: if it's already owned, equip it; otherwise
   * buy it (debit the wallet, mark it owned) and equip it. Can't afford it →
   * nothing changes (the wallet refuses the spend).
   */
  private buyOrEquipPlatform(id: string, price: number): void {
    if (!platformOwned(id)) {
      if (!canAfford(price) || !spendCoins(price)) return; // can't afford — no-op
      ownPlatform(id);
      playCash(); // the money sting on a fresh purchase
    }
    setPlatformSkin(id); // applyOwnSkins repaints the pad next frame
  }

  /**
   * Shop tap on an avatar tile: own it → equip; else buy it (debit, mark owned,
   * cash sting) and equip. Can't afford → nothing changes.
   */
  private buyOrEquipAvatar(id: string, price: number): void {
    if (!avatarOwned(id)) {
      if (!canAfford(price) || !spendCoins(price)) return; // can't afford — no-op
      ownAvatar(id);
      playCash();
    }
    setAvatarSkin(id); // applyOwnSkins repaints the rig + mirror next frame
  }

  /** Walk into the club without leaving the active XR document. The navigation
   *  bridge falls back to the standalone pub page when no shared shell exists. */
  private gotoPub(): void {
    requestClubEntry(this.world, pubUrl());
  }

  /** Passthrough and opaque rendering need different Quest compositor modes.
   *  End only when the player explicitly crosses that boundary; the landing
   *  button immediately offers the matching AR/VR re-entry. */
  private restartForEnvironmentMode(): void {
    const session = this.world.session as XRSession | undefined;
    if (!session) return;
    const wantsOpaque = app.environment !== 'ar';
    const isOpaque = session.environmentBlendMode === 'opaque';
    if (wantsOpaque !== isOpaque) void session.end();
  }

  // --- customisation: the avatar mirror + live skin application ---------------

  /**
   * The "mirror": your full boxer rig standing beside the customisation
   * panel in a relaxed guard, re-skinned live as you click chips — so you
   * see exactly how you'll look across the gap.
   */
  private ensureMirror(): void {
    if (this.mirror) return;
    const rig = buildBoxer(0);
    const group = new Group();
    group.name = 'mirror-avatar';
    for (const piece of rig.all) {
      piece.visible = true;
      group.add(piece);
    }
    // Static display pose: solve the torso once under a standing head, fists
    // up in a loose guard. Group-local coords, so place/turn the group only.
    solveTorso(rig, new Vector3(0, 1.5, 0), new Quaternion(), 0, 0, _dir, _end);
    rig.gloves[0].position.set(-0.22, 1.12, -0.28);
    rig.gloves[1].position.set(0.22, 1.12, -0.28);
    group.position.set(-0.75, 0, -2.0);
    // Face the player standing at the rig origin (default forward is -Z).
    group.rotation.y = Math.PI + Math.atan2(0 - group.position.x, 0 - group.position.z);
    this.scene.add(group);
    this.mirror = { group, rig };
    this.skinVersion = -1; // force a re-apply so the mirror dresses correctly
    this.accentHue = Number.NaN;
    this.accentLight = Number.NaN;
  }

  /**
   * Re-skin everything that's YOURS whenever the picks change: the mirror,
   * your torso, both gloves and your platform. Visual only — PlayerBodyPart
   * hitboxes never move.
   */
  private applyOwnSkins(): void {
    const skinChanged = customization.version !== this.skinVersion;
    const accentChanged = app.accentHue !== this.accentHue || app.accentLight !== this.accentLight;
    if (!skinChanged && !accentChanged) return;

    const names = ['player-torso', 'player-glove-left', 'player-glove-right', 'mirror-avatar'];
    if (skinChanged) {
      this.skinVersion = customization.version;
      const av = myAvatarSkin(); // chosen shape + custom colour
      // A STORE try-on dresses the MIRROR only (your own body keeps what you
      // actually own) in the previewed shape — with your colour picks, so it
      // shows exactly what you'd get.
      const pv = customization.preview;
      const mirrorAv = pv?.kind === 'avatar' ? resolveAvatarSkin(pv.id, customization.colorHue, customization.colorLight) : av;
      for (const name of names) {
        const obj = this.scene.getObjectByName(name);
        if (obj) applyAvatarSkin(obj, name === 'mirror-avatar' ? mirrorAv : av);
      }
      const pad = this.scene.getObjectByName('player-platform');
      if (pad) applyPlatformSkin(pad, platformSkin(customization.platform));
      // A platform try-on models on the OPPONENT's pad across the gap — the
      // whole deck in view at once, no craning at your own feet. When the
      // try-on ends, the pad goes back to the house look the lobby paints
      // (full re-apply first: a premium slab tint or deck ornament would
      // survive a plain re-tint).
      const oppPad = this.scene.getObjectByName('opponent-platform');
      if (oppPad) {
        if (pv?.kind === 'platform') {
          applyPlatformSkin(oppPad, platformSkin(pv.id));
          this.oppPadPreviewed = true;
        } else if (this.oppPadPreviewed) {
          this.oppPadPreviewed = false;
          applyPlatformSkin(oppPad, OPPONENT_DEFAULT_PLATFORM);
          tintPlatform(oppPad, teamColor(1));
        }
      }
      this.accentHue = Number.NaN;
    }

    const accent = hueToColor(app.accentHue, app.accentLight);
    for (const name of names) {
      const obj = this.scene.getObjectByName(name);
      if (obj) setAvatarAccent(obj, accent);
    }
    this.accentHue = app.accentHue;
    this.accentLight = app.accentLight;
  }

  /** Point + trigger types on the keyboard; OK saves and resumes the action. */
  private updateKeyboard(): void {
    let hover: string | null = null;
    for (const hand of ['left', 'right'] as const) {
      const hit = this.updatePointer(hand, [this.keyboard.mesh]);
      const id = hit?.uv ? this.keyboard.hitTest(hit.uv.x, hit.uv.y) : null;
      if (!id) continue;
      hover = id;
      if (this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) {
        sfx.uiClick();
        const done = this.keyboard.press(id);
        if (done !== null) {
          if (this.kbMode === 'report') {
            // Empty OK = changed their mind; anything else files the report.
            if (done.trim().length > 0) {
              void sendReport(done);
              markReportSent();
            }
          } else if (this.kbMode === 'note') {
            setPlayerNote(done); // empty clears the note
            clearProfileKeyboardHint();
          } else if (done.length > 0) {
            setPlayerName(done);
          } else {
            return; // a name is required — ignore empty OK, leave the keyboard up
          }
          this.kbMode = 'name';
          this.keyboard.close();
          const pending = this.kbPending;
          this.kbPending = null;
          if (pending) this.run(pending);
          else this.menu.redrawAll(this.hovered, this.hoveredAction);
          return;
        }
      }
    }
    this.keyboard.setHover(hover);
  }

  // --- the A-button action panel ---------------------------------------------

  /**
   * What the panel offers right now, or null when it has no business being
   * up (mid-bout — your hands are for punching, not menus).
   */
  /** The resign button — or, once tapped, its are-you-sure ✕ / ✓ pair. */
  private forfeitButtons(label: string): ActionButton[] {
    return this.confirmForfeit
      ? [
          { id: 'forfeit-no', label: '✕ NO', accent: UI.cool, half: 'l' },
          { id: 'forfeit-yes', label: `✓ ${label}`, accent: UI.danger, half: 'r' },
        ]
      : [{ id: 'forfeit', label, accent: UI.danger }];
  }

  private panelContent(): { title: string; buttons: ActionButton[]; status: string; loadout: boolean } | null {
    if (app.state === 'training') {
      return {
        title: 'AIM TRAINING',
        buttons: this.forfeitButtons('FORFEIT'),
        status: this.confirmForfeit ? 'end the session?' : '',
        loadout: true, // practice range — swap attachments whenever
      };
    }
    // A live titan bout can be conceded — souls fights run long, and the
    // campaign has no round clock to save you. PvE, so the loadout rides too.
    if (app.state === 'playing' && app.mode === 'campaign' && match.phase !== 'matchOver') {
      return {
        title: 'TITAN BOUT',
        buttons: this.forfeitButtons('CONCEDE'),
        status: this.confirmForfeit ? 'give up the bout?' : '',
        loadout: true,
      };
    }
    if (app.state === 'playing' && match.phase === 'matchOver') {
      const buttons: ActionButton[] = [];
      if (app.mode === 'net') {
        buttons.push({
          id: 'rematch',
          label: match.rematchMine ? 'WAITING…' : 'REMATCH',
          accent: UI.cool,
        });
      }
      buttons.push({ id: 'return', label: 'RETURN', accent: UI.danger });
      return {
        title: 'FIGHT OVER',
        buttons,
        status: match.rematchTheirs ? `${rival.name} wants a rematch` : '',
        loadout: false,
      };
    }
    // The round break (pre-fight hold, 3-2-1, the roundOver breather): every
    // mode gets the BALL LOADOUT here — resigning stays a bots-only luxury
    // (live opponents deserve a finished match; net bouts end at matchOver).
    if (app.state === 'playing' && (match.phase === 'roundOver' || match.phase === 'countdown')) {
      return {
        title: 'ROUND BREAK',
        buttons: app.mode === 'bot' ? this.forfeitButtons('FORFEIT') : [],
        status: this.confirmForfeit && app.mode === 'bot' ? 'give up the bout?' : '',
        loadout: true,
      };
    }
    // Mid-round against bots (quick match still hunting, VS BOTS brawls):
    // resigning is allowed — nobody human is owed the rest of the fight. The
    // tutorial keeps its guided flow: no panel there.
    if (app.state === 'playing' && app.mode === 'bot' && match.phase === 'playing' && !app.tutorial) {
      return {
        title: 'BOT BOUT',
        buttons: this.forfeitButtons('FORFEIT'),
        status: this.confirmForfeit ? 'give up the bout?' : '',
        loadout: false,
      };
    }
    return null;
  }

  /** A toggles the panel; point + trigger clicks its buttons. */
  private updateActionPanel(): void {
    // The rematch decision pops the panel up by itself in online bouts.
    const over = app.state === 'playing' && match.phase === 'matchOver';
    if (over && !this.wasMatchOver && app.mode === 'net' && !this.panel.mesh.visible) {
      this.panel.mesh.visible = true;
      this.placePanel();
    }
    this.wasMatchOver = over;

    const content = this.panelContent();
    if (!content) {
      this.panel.mesh.visible = false;
      this.confirmForfeit = false;
      this.hidePointers();
      return;
    }

    if (this.input.xr.gamepads.right?.getButtonDown(InputComponent.A_Button)) {
      this.panel.mesh.visible = !this.panel.mesh.visible;
      this.confirmForfeit = false; // dismissing or reopening disarms the ✕/✓
      if (this.panel.mesh.visible) this.placePanel();
      sfx.ensureAudio();
      sfx.uiClick();
    }
    if (!this.panel.mesh.visible) {
      this.hidePointers();
      return;
    }

    let hover: string | null = null;
    for (const hand of ['left', 'right'] as const) {
      const hit = this.updatePointer(hand, [this.panel.mesh]);
      if (!hit?.uv) continue;
      const id = this.panel.hitTest(hit.uv.x, hit.uv.y);
      const down = this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger) ?? false;
      if (id) {
        hover = id;
        if (down) {
          this.runPanelAction(id);
          return;
        }
        continue;
      }
      // The loadout section: taps equip/clear attachments between rounds.
      if (down && content.loadout) {
        const bh = this.panel.ballsHit(hit.uv.x, hit.uv.y);
        if (bh && clickBalls(bh.u, bh.v)) {
          sfx.uiClick();
          this.panelKey = ''; // repaint with the new equip state
        }
      }
    }

    // Redraw only when the content or hover actually changed.
    const key = `${content.title}|${content.buttons.map((b) => b.id + b.label).join(',')}|${content.status}|${content.loadout}|${hover}`;
    if (key !== this.panelKey) {
      this.panelKey = key;
      this.panel.redraw(content.title, content.buttons, 'press A to dismiss', hover, content.status, content.loadout);
    }
  }

  /** Open the shared lobby modal for `mode`. Re-entering mid-lobby (e.g. after
   *  a look around) lands back in your seated room, not the browser. */
  private openLobby(mode: ArcadeMode): void {
    app.lobbyMode = mode;
    app.lobbyView = mesh.joined ? 'lobby' : 'browser';
  }

  /**
   * PRIVATE 2v2 / FFA: reserve a code, open the room, then hand straight over
   * to the ordinary arcade lobby lifecycle — seats fill, a full room
   * auto-launches, FFA can start short-handed, LEAVE tears it down. The room is
   * identical to a listed one except that it lives in `privateRooms`, so it
   * never appears in the browser and can only be reached by the code.
   */
  private hostPrivateBrawl(mode: ArcadeMode): void {
    void (async () => {
      try {
        const code = await mesh.hostPrivate(mode, myStats().name, (s) => {
          app.netStatus = s;
        });
        app.privateCode = code; // the lobby panel keeps it on screen
        app.lobbyMode = mode;
        app.lobbyView = 'lobby';
        app.state = 'menu';
        app.duelView = 'root';
      } catch {
        app.netStatus = 'could not open a private room';
        app.state = 'menu';
        app.duelView = 'private';
        app.privateCode = '';
      }
    })();
  }

  /**
   * Join by code without asking which format it is. A code belongs either to a
   * coded MESH room (2v2 / ffa — the doc carries its own mode) or to a 1v1 duel
   * room on the other transport, so try the mesh first and fall back to the
   * duel. That way a friend types five digits and lands in whatever the host
   * opened, which is the whole point of picking the format up front.
   */
  private joinByCode(code: string): void {
    void (async () => {
      const mode = await mesh.joinPrivate(code, myStats().name, (s) => {
        app.netStatus = s;
      });
      if (mode && mode !== '1v1') {
        app.privateCode = code;
        app.lobbyMode = mode;
        app.lobbyView = 'lobby';
        app.state = 'menu';
        app.duelView = 'root';
        app.codeEntry = '';
        return;
      }
      // Not a brawl code — let the duel transport try it (and own the error UI
      // when it isn't a valid code at all).
      net.joinPrivate(code);
    })();
  }

  /** VS BOTS / only-bots: drop straight into a bot brawl of `mode`, no mesh. */
  private startBotBrawl(mode: ArcadeMode): void {
    app.lobbyMode = null;
    app.lobbyView = 'browser';
    mesh.cancel();
    app.arcade = mode;
    app.mode = 'bot';
    app.state = 'playing';
  }

  /** The whole room drops into the bout together — the host flipped `started`
   *  on the room doc and every member launches off that mirrored signal. Raid
   *  enters the co-op titan run; 2v2 / ffa enter a live mesh brawl. */
  private launchLobby(): void {
    stopLobbyWatch();
    const mode = app.lobbyMode ?? 'raid';
    app.lobbyMode = null;
    app.lobbyRooms = [];
    app.privateCode = ''; // the invite code has done its job

    app.arcade = mode;
    app.mySlot = mesh.mySeat;
    if (mode === 'raid') {
      app.mode = 'campaign';
      app.campaignMode = 'raid';
      app.raidHardcore = mesh.raidHardcore;
      app.raidGoopliath = mesh.raidGoopliath;
      // Squad size snapshot — the boss is built for THIS many fists (2–5)
      // and stays that way even if someone drops mid-run.
      app.raidSize = Math.min(5, Math.max(1, mesh.occupants.filter(Boolean).length));
      app.difficulty = mesh.raidDifficulty; // the host's pick, mirrored to all
      app.campaignStage = 0;
    } else {
      // A live mesh brawl: seat 0 is match authority. MeshSystem's net rising
      // edge resets the per-bout pose/authority clocks.
      app.mode = 'net';
      app.side = mesh.isHost() ? 0 : 1;
    }
    app.state = 'playing';
    this.applyState();
  }

  private runPanelAction(id: string): void {
    sfx.uiClick();
    switch (id) {
      case 'forfeit':
        // Arm the are-you-sure ✕ / ✓ row — nothing ends on the first tap.
        this.confirmForfeit = true;
        this.panelKey = '';
        break;
      case 'forfeit-no':
        this.confirmForfeit = false;
        this.panelKey = '';
        break;
      case 'forfeit-yes':
      case 'return':
        this.confirmForfeit = false;
        this.panel.mesh.visible = false;
        // Ends a live net bout OR stops the bot-bout background search.
        if (app.state === 'playing') net.cancel();
        // A conceded raid leaves the squad (the room is spent) and lands at
        // the raid browser; a solo titan bout returns to the line-up.
        if (app.mode === 'campaign' && app.campaignMode === 'raid') {
          mesh.cancel();
          app.lobbyMode = 'raid';
          app.lobbyView = 'browser';
        } else if (app.mode === 'campaign') {
          app.campaignOpen = true;
        }
        app.state = 'menu'; // training tears down unsaved; bouts end here
        this.applyState();
        break;
      case 'rematch':
        if (!match.rematchMine) {
          match.rematchMine = true;
          net.send({ k: 'rematch' });
        }
        break;
    }
  }

  /** In front of you, off to the side, waist height — out of punching room. */
  private placePanel(): void {
    this.world.camera.getWorldPosition(_head);
    this.world.camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    // right = forward × up
    const rx = -_fwd.z;
    const rz = _fwd.x;
    this.panel.mesh.position.set(
      _head.x + _fwd.x * 0.55 + rx * 0.38,
      1.08, // chest height — at 0.95 the loadout (and its button row) sat a shade too low
      _head.z + _fwd.z * 0.55 + rz * 0.38,
    );
    // Yawed squarely toward the head with a FIXED lectern lean — a constant
    // tilt, never derived from the head (lookAt/damped pitch baked in whatever
    // your head was doing when you pressed A, and dead vertical was too
    // straight to point at comfortably from standing eye level).
    const dx = _head.x - this.panel.mesh.position.x;
    const dz = _head.z - this.panel.mesh.position.z;
    this.panel.mesh.rotation.order = 'YXZ';
    this.panel.mesh.rotation.set(-0.24, Math.atan2(dx, dz), 0);
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
    this.hits.length = 0; // reuse the scratch — no per-cast array allocation
    const hit = this.ray.intersectObjects(targets, false, this.hits)[0];
    if (hit) _end.copy(hit.point);
    else _end.copy(_origin).addScaledVector(_dir, 1.6);
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

  /** Breathe the red glow behind the FIRE FIGHT banner — a slow live pulse in
   *  opacity + scale while the banner is up. No-op out of the lobby (hidden). */
  private pulseBannerGlow(): void {
    const g = (this.bannerGlow ??= this.scene.getObjectByName('title-banner-glow') as Group | undefined);
    if (!g || !g.visible) return;
    const pulse = 0.5 + 0.5 * Math.sin((performance.now() / 1000) * 1.6); // ~0.25 Hz
    const s = 0.93 + pulse * 0.14; // 0.93 … 1.07
    g.scale.set(s, s, 1);
    // Breathe each layer's translucency around its base (haze 0.5, core 0.7).
    const base = [0.5, 0.7];
    g.children.forEach((child, i) => {
      const mat = (child as Mesh).material as MeshBasicMaterial;
      if (mat && base[i] !== undefined) mat.opacity = base[i] * (0.72 + pulse * 0.5); // ~0.72×…1.22×
    });
  }

  private hidePointers(): void {
    for (const hand of ['left', 'right'] as const) {
      this.pointers[hand].line.visible = false;
      this.pointers[hand].dot.visible = false;
    }
  }

  // --- visibility per state --------------------------------------------------

  private applyState(): void {
    const inLobby = app.state === 'menu' || app.state === 'queueing';
    this.menu.setVisible(inLobby);
    // Back in the lobby: hand the audio over — the victory sting rings out, then
    // (and only then) the lobby music fades up, so they never overlap. During a
    // bout / training the lobby music just pauses. Fired on the TRANSITION
    // only: applyState() runs after every lobby click (tab swaps included),
    // and re-running the handoff mid-fade used to yank the music to silence
    // and start the fade over — the locker ⇄ store warble.
    if (inLobby !== this.musicInLobby) {
      this.musicInLobby = inLobby;
      if (inLobby) handoffToLobby();
      else setMenuMusicActive(false);
    }
    // Fresh board standings + the day's Gasket Gazette whenever you land back
    // in the lobby (both throttled).
    if (inLobby) {
      void refreshLeaderboard();
      void refreshGazette();
    }

    // Live "N searching" (1V1 panel) and "X/12 in the pub" (pub door) counts —
    // only watched in the lobby.
    if (inLobby) {
      startQueueWatch((n) => {
        app.searching = n;
      });
      startPubWatch((counts) => {
        app.pubRegionCounts = counts;
        // Door badge shows the total across all reachable regions.
        const known = Object.values(counts).filter((c) => c >= 0);
        app.pubCount = known.length ? known.reduce((a, b) => a + b, 0) : -1;
      });
    } else {
      stopQueueWatch();
      app.searching = -1;
      stopPubWatch();
      app.pubCount = -1;
      app.pubRegionCounts = {};
      app.infoView = 'root';
    }

    // Returning to the lobby from a ranked bout drops you back on the server
    // list (onMatched left duelView at 'root'), so you can host or join again.
    if (inLobby && app.state === 'menu' && app.fromRanked && app.duelView === 'root') {
      app.duelView = 'browser';
    }
    // Watch the open ranked rooms across the whole lobby (not just inside the
    // browser) so the RANKED button can show a live "N open" count.
    if (inLobby) {
      startRankedWatch((rooms) => {
        app.rankedRooms = rooms;
      });
      // …and the forming raid squads, so the RAID button can badge them too.
      startRaidWatch((n) => {
        app.raidsOpen = n;
      });
    } else {
      stopRankedWatch();
      app.rankedRooms = [];
      stopRaidWatch();
      app.raidsOpen = -1;
    }

    // The action panel only lives inside training runs and bouts; the
    // keyboard only in the lobby.
    if (inLobby && this.panel) {
      this.panel.mesh.visible = false;
      this.panelKey = '';
      this.wasMatchOver = false;
    }
    if (!inLobby && this.keyboard) {
      this.keyboard.close();
      this.kbPending = null;
    }
    // Customisation (panel + mirror) and the gazette are lobby-only affairs.
    if (!inLobby) {
      customization.open = false;
      app.gazetteOpen = false;
      if (this.mirror) this.mirror.group.visible = false;
    }

    // The title banner (and its live red glow) show only in the lobby.
    const banner = this.scene.getObjectByName('title-banner');
    if (banner) banner.visible = inLobby;
    const bannerGlow = this.scene.getObjectByName('title-banner-glow');
    if (bannerGlow) bannerGlow.visible = inLobby;
    // Outside a live bout, fall back to the classic duel layout so the lobby
    // and Aim Training show one opponent pad, not a leftover arcade cross,
    // and leave any arcade mesh room we were in. EXCEPT while a lobby modal
    // is up: an arcade LOBBY is a live mesh room parked in the menu state —
    // cancelling here would tear down the squad you just hosted or joined.
    if (app.state !== 'playing' && app.lobbyMode === null) {
      mesh.cancel();
      app.arcade = '1v1';
      app.mySlot = 0;
      applyArenaLayout(this.scene);
    }
    // The opponent's platform reads as "occupied" only when fighting.
    const oppPlatform = this.scene.getObjectByName('opponent-platform');
    if (oppPlatform) oppPlatform.visible = app.state !== 'training';

    if (inLobby) this.menu.redrawAll(this.hovered, this.hoveredAction);
    this.lastState = app.state;
  }
}
