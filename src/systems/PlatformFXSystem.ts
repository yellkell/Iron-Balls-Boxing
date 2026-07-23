/**
 * Animates the two earned trophy platforms.
 *
 * Ordinary platform skins stay static and cheap. BLAZING and TIDEBREAKER tag
 * only their small ornament groups in arena.ts, so this system can give those
 * rewards a living silhouette without touching gameplay geometry or hitboxes.
 */

import { createSystem } from '@iwsdk/core';
import { Mesh, MeshBasicMaterial, PointLight, type Object3D } from 'three';

/** Animate one tagged ornament. Exported so the lightweight visual test scene
 * can exercise the exact same motion as the in-game system. */
export function animatePlatformFxNode(node: Object3D, t: number): void {
  const role = node.userData.fxRole as string;
  const phase = (node.userData.fxPhase as number | undefined) ?? 0;
  switch (role) {
    case 'blazing-emblem':
    case 'blazing-emblem-core': {
      const pulse = 1 + Math.sin(t * 3.4) * 0.035;
      node.scale.set(pulse, pulse, 1);
      break;
    }
    case 'blazing-rail': {
      node.rotation.z = t * 0.18;
      const mat = (node as Mesh).material as MeshBasicMaterial;
      mat.opacity = 0.58 + Math.sin(t * 4.2) * 0.14;
      break;
    }
    case 'blazing-jet': {
      const lick = 0.82 + Math.sin(t * 5.6 + phase) * 0.18;
      node.scale.set(0.9 + lick * 0.1, lick, 1);
      break;
    }
    case 'blazing-ember': {
      const rise = (t * 0.42 + phase) % 1;
      node.position.y = (node.userData.fxBaseY as number) + rise * 0.38;
      const size = Math.sin(rise * Math.PI) * 0.9 + 0.12;
      node.scale.setScalar(size);
      break;
    }
    case 'blazing-light':
      (node as PointLight).intensity = 2.5 + Math.sin(t * 4.6) * 0.55;
      break;
    case 'tide-emblem': {
      const breathe = 1 + Math.sin(t * 2.1) * 0.045;
      node.scale.set(breathe, breathe, 1);
      break;
    }
    case 'tide-pool': {
      const mat = (node as Mesh).material as MeshBasicMaterial;
      mat.opacity = 0.23 + Math.sin(t * 1.9) * 0.07;
      break;
    }
    case 'tide-ring': {
      const wash = (t * 0.28 + phase) % 1;
      const scale = 0.72 + wash * 0.5;
      node.scale.setScalar(scale);
      const mat = (node as Mesh).material as MeshBasicMaterial;
      mat.opacity = (1 - wash) * 0.5;
      break;
    }
    case 'tide-crest': {
      const swell = 0.82 + Math.sin(t * 2.6 + phase) * 0.18;
      node.scale.y = swell;
      break;
    }
    case 'tide-bubble': {
      const rise = (t * 0.24 + phase) % 1;
      node.position.y = (node.userData.fxBaseY as number) + rise * 0.3;
      const size = Math.sin(rise * Math.PI) * 0.7 + 0.25;
      node.scale.setScalar(size);
      break;
    }
    case 'tide-drip':
      node.position.y = (node.userData.fxBaseY as number) + Math.sin(t * 2.2 + phase) * 0.015;
      break;
    case 'tide-light':
      (node as PointLight).intensity = 2.0 + Math.sin(t * 2.3) * 0.35;
      break;
  }
}

export class PlatformFXSystem extends createSystem({}) {
  private time = 0;
  private nodes: Object3D[] = [];

  init(): void {
    this.scene.traverse((o) => {
      if (o.userData?.fxRole) this.nodes.push(o);
    });
  }

  update(delta: number): void {
    this.time += delta;
    const t = this.time;

    for (const node of this.nodes) {
      // A hidden skin ornament inherits invisibility from its root. Skip its
      // animation entirely until that platform is actually being worn.
      let visible = node.visible;
      for (let p = node.parent; visible && p; p = p.parent) visible = p.visible;
      if (!visible) continue;

      animatePlatformFxNode(node, t);
    }
  }
}
