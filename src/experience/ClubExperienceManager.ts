import type { World } from '@iwsdk/core';
import { Color, type Fog, type FogExp2, type Object3D, type Texture } from 'three';
import * as sfx from '../audio/sfx.js';
import { setMenuMusicActive } from '../audio/menuMusic.js';
import { clearFirePools } from '../fx/fire.js';
import { DesertSystem } from '../systems/DesertSystem.js';
import { teleportPlayer } from '../pub/systems/TeleportSystem.js';
import type { PubExperience } from '../pub/experience.js';
import { LoadingOverlay } from './LoadingOverlay.js';
import { setClubNavigationHandlers } from './clubNavigation.js';

interface PausableSystem {
  play(): void;
  stop(): void;
}

interface VisualBaselines {
  scene: ReadonlySet<Object3D>;
  level: ReadonlySet<Object3D>;
}

type Background = Color | Texture | null;

interface ArenaRenderState {
  background: Background;
  environment: Texture | null;
  environmentIntensity: number;
  fog: Fog | FogExp2 | null;
  clearColor: Color;
  clearAlpha: number;
}

function nextRenderFrame(world: World): Promise<void> {
  return new Promise((resolve) => {
    const session = world.session;
    if (session) session.requestAnimationFrame(() => resolve());
    else window.requestAnimationFrame(() => resolve());
  });
}

/**
 * Owns the single-session arena <-> club swap. Arena ECS systems are paused,
 * arena-owned scene nodes are hidden, and the lazily imported pub subtree is
 * activated without replacing the document, renderer, XR origin or session.
 */
export function installClubExperienceManager(
  world: World,
  arenaSystems: PausableSystem[],
  baselines: VisualBaselines,
): void {
  const overlay = new LoadingOverlay(world.camera);
  const arenaSceneObjects = new Set<Object3D>();
  const arenaLevelObjects = new Set<Object3D>();
  let arenaVisibility = new Map<Object3D, boolean>();
  let renderState: ArenaRenderState | null = null;
  let pubExperience: PubExperience | null = null;
  let location: 'arena' | 'club' = 'arena';
  let transitioning = false;
  let activeSession: XRSession | null = null;

  const collectArenaObjects = (): void => {
    const pubRoot = (() => {
      try {
        // Loaded only after the first visit; avoid making the pub a static
        // dependency of the arena bundle.
        return (world.scene.getObjectByName('iron-balls-pub') as Object3D | undefined) ?? null;
      } catch {
        return null;
      }
    })();

    for (const child of world.scene.children) {
      if (!baselines.scene.has(child) && child !== pubRoot) arenaSceneObjects.add(child);
    }
    const levelRoot = world.getActiveRoot();
    for (const child of levelRoot.children) {
      if (!baselines.level.has(child) && child !== pubRoot) arenaLevelObjects.add(child);
    }
  };

  const hideArenaVisuals = (): void => {
    collectArenaObjects();
    arenaVisibility = new Map();
    for (const object of new Set([...arenaSceneObjects, ...arenaLevelObjects])) {
      if (!object.parent) continue;
      arenaVisibility.set(object, object.visible);
      object.visible = false;
    }
  };

  const restoreArenaVisuals = (): void => {
    for (const [object, visible] of arenaVisibility) {
      if (object.parent) object.visible = visible;
    }
    arenaVisibility.clear();
  };

  const captureRenderState = (): void => {
    renderState = {
      background: world.scene.background,
      environment: world.scene.environment,
      environmentIntensity: world.scene.environmentIntensity,
      fog: world.scene.fog,
      clearColor: world.renderer.getClearColor(new Color()).clone(),
      clearAlpha: world.renderer.getClearAlpha(),
    };
  };

  const restoreRenderState = (): void => {
    if (!renderState) return;
    world.scene.background = renderState.background;
    world.scene.environment = renderState.environment;
    world.scene.environmentIntensity = renderState.environmentIntensity;
    world.scene.fog = renderState.fog;
    world.renderer.setClearColor(renderState.clearColor, renderState.clearAlpha);
    renderState = null;
  };

  const pauseArena = (): void => {
    for (const system of arenaSystems) system.stop();
    setMenuMusicActive(false);
    clearFirePools();
  };

  const resumeArena = (): void => {
    for (const system of arenaSystems) system.play();
    restoreRenderState();
    restoreArenaVisuals();
    world.getSystem(DesertSystem)?.restoreEnvironment();
    setMenuMusicActive(true);
    clearFirePools();
  };

  const leaveClub = async (showOverlay = true): Promise<void> => {
    if (transitioning || location !== 'club') return;
    transitioning = true;
    if (showOverlay) {
      overlay.show('THE ARENA');
      await nextRenderFrame(world);
    }

    try {
      activeSession?.removeEventListener('end', onSessionEnd);
      activeSession = null;
      pubExperience?.leave();
      world.player.position.y = 0;
      teleportPlayer(world.player, 0, 0, 0);
      resumeArena();
      location = 'arena';
      window.dispatchEvent(new CustomEvent('ibb:location', { detail: location }));
      await nextRenderFrame(world);
    } finally {
      overlay.hide();
      transitioning = false;
    }
  };

  const onSessionEnd = (): void => {
    if (location === 'club') void leaveClub(false);
  };

  const enterClub = async (): Promise<void> => {
    if (transitioning || location !== 'arena') return;
    transitioning = true;
    overlay.show('IRON BALLS', 'BAR & FIGHT CLUB · EST. 2026');
    await nextRenderFrame(world);

    captureRenderState();
    pauseArena();
    hideArenaVisuals();
    world.scene.fog = null;
    world.scene.background = new Color(0x07080b);
    world.renderer.setClearColor(0x07080b, 1);

    try {
      overlay.update();
      const { mountPubExperience } = await import('../pub/experience.js');
      pubExperience ??= mountPubExperience(world);
      await nextRenderFrame(world);

      overlay.update();
      pubExperience.enter();
      location = 'club';
      window.dispatchEvent(new CustomEvent('ibb:location', { detail: location }));
      activeSession = world.session ?? null;
      activeSession?.addEventListener('end', onSessionEnd, { once: true });

      await nextRenderFrame(world);
      sfx.ensureAudio();
      sfx.saloonEntry();
      overlay.hide();
    } catch (error) {
      console.error('[club] same-session transition failed', error);
      pubExperience?.leave();
      world.player.position.y = 0;
      teleportPlayer(world.player, 0, 0, 0);
      resumeArena();
      window.dispatchEvent(new CustomEvent('ibb:location', { detail: 'arena' }));
      overlay.update();
      await nextRenderFrame(world);
      overlay.hide();
    } finally {
      transitioning = false;
    }
  };

  setClubNavigationHandlers({
    enter: enterClub,
    leave: leaveClub,
  });
}
