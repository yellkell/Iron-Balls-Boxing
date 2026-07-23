/**
 * FIRE FIGHT — entry point.
 *
 * Boots an IWSDK World with a WebXR **passthrough** (immersive-AR) session:
 * the two glowing platforms, the rim barrier and the iron boxer float in your
 * real room. If the device can't do AR, IWSDK falls back to VR.
 *
 * Run `npm run dev` and open the page: on a headset you'll get an "Enter AR"
 * offer; on desktop the IWSDK dev plugin provides a WebXR emulator
 * (WASD + mouse). For online 1v1s also run `npm run server`.
 */

import { launchXR, SessionMode, World } from '@iwsdk/core';
import { installCrashTrap } from './debug/crashTrap.js';
import { initLeaderboard } from './net/leaderboard.js';
import { initGazette } from './net/gazette.js';
import { enterMenuMusic } from './audio/menuMusic.js';
import { ensureAudio } from './audio/sfx.js';
import { preloadTutorVoice } from './audio/tutorVoice.js';
import { app } from './menu/appState.js';
import { buildArena } from './arena/arena.js';
import { setupEnvironment } from './arena/environment.js';
import { setupCombatants } from './combat/setup.js';
import { PlayerBodySystem } from './systems/PlayerBodySystem.js';
import { OpponentSystem } from './systems/OpponentSystem.js';
import { BotSystem } from './systems/BotSystem.js';
import { NetworkSystem } from './systems/NetworkSystem.js';
import { MeshSystem } from './systems/MeshSystem.js';
import { TrainingSystem } from './systems/TrainingSystem.js';
import { TutorialSystem } from './systems/TutorialSystem.js';
import { CampaignSystem } from './systems/CampaignSystem.js';
import { FireballSystem } from './systems/FireballSystem.js';
import { CollisionSystem } from './systems/CollisionSystem.js';
import { BoundarySystem } from './systems/BoundarySystem.js';
import { GameStateSystem } from './systems/GameStateSystem.js';
import { CountdownSystem } from './systems/CountdownSystem.js';
import { MenuSystem } from './systems/MenuSystem.js';
import { PromotionSystem } from './systems/PromotionSystem.js';
import { PlayerFeedbackSystem } from './systems/PlayerFeedbackSystem.js';
import { PlayerGloveSystem } from './systems/PlayerGloveSystem.js';
import { PlayerGestureSystem } from './systems/PlayerGestureSystem.js';
import { FXSystem } from './systems/FXSystem.js';
import { DesertSystem } from './systems/DesertSystem.js';

installCrashTrap(); // headset playtests have no console — trap + persist crashes

const container = document.getElementById('scene-container') as HTMLDivElement;
const enterVrButton = document.getElementById('enter-vr') as HTMLButtonElement | null;

enterVrButton?.setAttribute('disabled', '');

function hideLanding(): void {
  document.body.classList.add('app-entered');
}

function showLanding(): void {
  document.body.classList.remove('app-entered');
  enterVrButton?.removeAttribute('disabled');
}

World.create(container, {
  // The landing button calls IWSDK's explicit WebXR launcher from the user's
  // tap. Quest Browser needs that direct requestSession gesture path.
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    offer: 'none',
  },
  // A stationary dodge game: no locomotion (you stay on your platform), no
  // grab system (the fireballs are bonded to your fists, not grabbed).
  features: {
    grabbing: false,
    locomotion: false,
    spatialUI: false,
  },
  render: {
    // We light the scene ourselves (see setupEnvironment) and let passthrough
    // provide the backdrop, so the default sky is off.
    defaultLighting: false,
    // Far enough to render the optional desert's horizon mesas + sun disc when
    // that backdrop is switched on; harmless in bare AR (nothing's out there).
    far: 1600,
    camera: { position: [0, 1.6, 0] },
  },
}).then(async (world) => {
  // Quest's default maximum fixed foveation (super-three's WebXRManager ships
  // foveation = 1.0) renders the display edges at lower resolution, and the
  // boundary between foveation regions shows up as a head-locked dark band on
  // dark/high-contrast content. Full resolution kills it outright; raise toward
  // ~0.2 later if we want some of the perf back without exposing the seam.
  world.renderer.xr.setFoveation(0);

  initLeaderboard(); // anonymous profile + first board fetch
  initGazette(); // pull the day's Gasket Gazette for the lobby paper button
  setupEnvironment(world);
  buildArena(world);
  setupCombatants(world);

  // Body pose first so hitboxes are current for everything downstream.
  world.registerSystem(PlayerBodySystem);
  // Opponent drivers: exactly one of these writes the bus per bout.
  world.registerSystem(BotSystem);
  world.registerSystem(NetworkSystem);
  world.registerSystem(MeshSystem);
  world.registerSystem(OpponentSystem);
  // Aim Training: targets, scoring, return fire.
  world.registerSystem(TrainingSystem);
  // ARCADE campaign: the five-titan gauntlet (its own boss rig, telegraphed
  // attacks and HUD — GameStateSystem stands down for these bouts).
  world.registerSystem(CampaignSystem);
  // The guided basics tutorial — rides a bot bout, paces it with pop-ups. Runs
  // before FireballSystem so its command-bus tweaks land before the balls sim.
  world.registerSystem(TutorialSystem);
  // The fireballs themselves, then collision (so it sees final positions).
  world.registerSystem(FireballSystem);
  world.registerSystem(CollisionSystem);
  // Rim barrier damage, then the match brain + scoreboards.
  world.registerSystem(BoundarySystem);
  world.registerSystem(GameStateSystem);
  // The big in-world 3-2-1-FIGHT hanging between the platforms.
  world.registerSystem(CountdownSystem);
  // Lobby menu, promotion celebration, hit vignette, gloves, transient FX.
  world.registerSystem(MenuSystem);
  world.registerSystem(PromotionSystem);
  world.registerSystem(PlayerFeedbackSystem);
  world.registerSystem(PlayerGloveSystem);
  world.registerSystem(PlayerGestureSystem);
  world.registerSystem(FXSystem);
  // The optional papercraft desert backdrop (off = bare AR passthrough).
  world.registerSystem(DesertSystem);

  // Passthrough AR when the device offers it; otherwise fall back to plain
  // immersive VR — the desert backdrop paints the world in, so nothing is
  // lost but the passthrough novelty. Without this fallback a VR-only
  // context (some packaged-app webviews, older headsets) left the button
  // dead on "XR unavailable" — a player stuck at the landing page forever
  // (Meta review VRC.Quest.Functional.3, 2026-07).
  //
  // isSessionSupported can HANG (never settle) in the Horizon OS packaged-PWA
  // webview when the runtime already holds the immersive session slot —
  // observed on-device 2026-07-23. Never gate the button on an unsettled
  // promise: race each probe against a short timeout and, on timeout, assume
  // entry is possible. The click path's requestSession is the real arbiter —
  // if it throws, that surfaces visibly rather than as a dead grey button.
  const probe = (mode: SessionMode): Promise<boolean> =>
    Promise.race([
      navigator.xr?.isSessionSupported(mode).catch(() => false) ?? Promise.resolve(false),
      new Promise<boolean>((resolve) => window.setTimeout(() => resolve(true), 1500)),
    ]);
  const arSupported = (await probe(SessionMode.ImmersiveAR)) === true;
  const vrSupported = arSupported || (await probe(SessionMode.ImmersiveVR)) === true;
  const sessionMode = arSupported ? SessionMode.ImmersiveAR : SessionMode.ImmersiveVR;
  const xrSupported = vrSupported;

  const startXR = () => {
    enterVrButton?.setAttribute('disabled', '');
    enterMenuMusic(); // lobby music (unless muted last time) — within the gesture
    // A boxer who hasn't run the tutorial is headed straight for it — warm
    // Ember's voice clips now (decode works while the context is young), so
    // her very first "Over here." speaks instead of falling back to caption.
    if (!app.tutorialDone) {
      ensureAudio();
      preloadTutorVoice();
    }
    // No passthrough in a plain-VR session: a saved 'ar' backdrop would
    // render as a black void, so promote it to the desert.
    if (!arSupported && app.environment === 'ar') app.environment = 'desert';
    launchXR(world, { sessionMode });

    const watchForSession = () => {
      if (world.session) {
        hideLanding();
        world.session.addEventListener('end', showLanding, { once: true });
        return;
      }

      if (!document.body.classList.contains('app-entered')) {
        requestAnimationFrame(watchForSession);
      }
    };

    requestAnimationFrame(watchForSession);
    window.setTimeout(() => {
      if (!world.session) enterVrButton?.removeAttribute('disabled');
    }, 4000);
  };

  if (enterVrButton && xrSupported) {
    enterVrButton.removeAttribute('disabled');
    enterVrButton.addEventListener('click', startXR);
  } else if (enterVrButton) {
    enterVrButton.textContent = 'XR unavailable';
  }

  // Inside the packaged Horizon OS app there may be no visible 2D panel at
  // all: an immersive-mode PWA launches behind the system splash and the OS
  // waits for the CONTENT to start XR. Waiting for a button tap there means
  // waiting forever (Meta review: "stuck for an indefinite period after
  // launching"). The immersive PWA runtime permits a session request without
  // user activation at launch, so enter directly; in a regular browser this
  // path never runs and the landing button behaves exactly as before. If the
  // runtime does demand a gesture after all, the request rejects harmlessly
  // and the 4s re-arm above hands control back to the button.
  const packaged =
    document.referrer.startsWith('android-app://') ||
    window.matchMedia?.('(display-mode: standalone)')?.matches === true;
  if (packaged && xrSupported) startXR();

  // eslint-disable-next-line no-console
  console.info('[FIRE FIGHT] World ready — platforms set, fists hot.');
});
