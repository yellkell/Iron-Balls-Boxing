/**
 * The optional opaque ARENA BACKDROPS — the papercraft DESERT and the
 * dilapidated FACTORY (both ported/built in the spirit of yellkell/vrenv).
 * Builds each once, hidden, then shows the one matching `app.environment`
 * ('ar' | 'desert' | 'factory') — a toggle that holds across the lobby, bot
 * bouts, quick matches and Aim Training because it's keyed off a setting.
 *
 * AR ↔ backdrop is a render switch, not a session switch: in immersive-AR
 * opaque geometry replaces the passthrough feed, so showing an opaque sky dome
 * (and clearing the frame opaque) paints the real room out; hiding it and
 * clearing transparent again brings passthrough back. No new "Enter VR" gesture.
 */

import { createSystem } from '@iwsdk/core';
import { Color, Fog } from 'three';
import { app, type AppEnvironment } from '../menu/appState.js';
import { buildDesert, type Desert } from '../arena/desert/index.js';
import { buildFactory, type Factory } from '../arena/factory/index.js';
import { buildSaltFlats, type SaltFlats } from '../arena/saltflats/index.js';
import { CONFIG } from '../arena/desert/config.js';

export class DesertSystem extends createSystem({}) {
  private desert?: Desert;
  private factory?: Factory;
  private saltflats?: SaltFlats;
  private saltFog?: Fog;
  private applied: AppEnvironment | null = null;
  private time = 0;
  private desertSky = new Color(CONFIG.sky.horizon);

  init(): void {
    // Shadows compiled in once up front so flipping a backdrop on later never
    // forces a material recompile mid-session; with no sun in AR they're free.
    this.world.renderer.shadowMap.enabled = true;
    // Nothing that casts a shadow ever MOVES (only the static desert props do),
    // so the shadow map is identical every frame — render it once per backdrop
    // change instead of every frame. A real GPU saving with no visible change.
    this.world.renderer.shadowMap.autoUpdate = false;

    this.desert = buildDesert();
    this.scene.add(this.desert.root);
    this.factory = buildFactory();
    this.scene.add(this.factory.root);
    this.saltflats = buildSaltFlats();
    this.scene.add(this.saltflats.root);
    // The salt flats read as infinite by fogging the far pan into the horizon
    // band. Near start (30 m) is well beyond the fighters/platforms (≤3 m), so
    // only the distance hazes. Applied/cleared per backdrop in apply().
    this.saltFog = new Fog(this.saltflats.skyColor.getHex(), 30, 700);
    this.apply(app.environment); // honour the saved choice on boot
  }

  update(delta: number): void {
    this.time += delta;
    if (app.environment !== this.applied) this.apply(app.environment);
    if (app.environment === 'desert') this.desert?.update(delta, this.time);
    else if (app.environment === 'factory') this.factory?.update(delta, this.time);
    else if (app.environment === 'saltflats') this.saltflats?.update(delta, this.time);
  }

  /** Re-assert the selected arena backdrop after an opaque club visit. */
  restoreEnvironment(): void {
    this.apply(app.environment);
  }

  /** Swap the backdrop: an opaque desert/saltflats/factory dome vs transparent AR passthrough. */
  private apply(env: AppEnvironment): void {
    this.applied = env;
    if (this.desert) this.desert.root.visible = env === 'desert';
    if (this.factory) this.factory.root.visible = env === 'factory';
    if (this.saltflats) this.saltflats.root.visible = env === 'saltflats';
    // Salt-flats fog only — melts the far pan into the horizon; cleared for
    // every other backdrop so it never tints the desert/factory/AR.
    this.scene.fog = env === 'saltflats' ? this.saltFog ?? null : null;
    // Re-bake the (otherwise frozen) shadow map once to reflect the new backdrop.
    this.world.renderer.shadowMap.needsUpdate = true;

    const renderer = this.world.renderer;
    if (env === 'ar') {
      // Back to passthrough: transparent backdrop, transparent clear.
      this.scene.background = null;
      renderer.setClearAlpha(0);
    } else {
      // Opaque sky so passthrough is fully painted out behind the scene.
      this.scene.background =
        env === 'factory' && this.factory
          ? this.factory.skyColor
          : env === 'saltflats' && this.saltflats
            ? this.saltflats.skyColor
            : this.desertSky;
      renderer.setClearAlpha(1);
    }
  }
}
