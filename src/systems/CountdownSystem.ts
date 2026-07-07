/**
 * The big in-world round countdown: "3… 2… 1… FIGHT" hanging huge in the air
 * over the middle of the arena — between the platforms, not just on the HUD.
 *
 * It mirrors `match.message` (every mode's match brain — local, 1v1 net,
 * mesh — funnels its countdown through that string), so this system never
 * needs to know whose clock is authoritative. Each new figure POPS in
 * slightly oversized and settles as it fades up; anything that isn't a
 * countdown beat ("KO", "YOU WIN", scores…) hides the board, which keeps the
 * dramatic endgame text on the HUD where it can be read while moving.
 */

import { createSystem } from '@iwsdk/core';
import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { localLayout } from '../combat/layout.js';
import { match } from '../combat/matchState.js';
import { app } from '../menu/appState.js';
import { countdownArt } from '../ui/countdownArt.js';
import { drawContentPlate } from '../ui/plateArt.js';

/** The messages that belong to the countdown ritual — drawn with the same
 *  neon-metal plate PNGs the HUD scoreboard uses (countdownArt), with these
 *  colours as the stencil fallback for the frames before a plate decodes. */
const BEAT_STYLE: Record<string, { fill: string; glow: string }> = {
  '3': { fill: '#f4f6fb', glow: 'rgba(170,225,255,0.95)' },
  '2': { fill: '#f4f6fb', glow: 'rgba(170,225,255,0.95)' },
  '1': { fill: '#ffb62e', glow: 'rgba(255,150,30,0.95)' },
  FIGHT: { fill: '#ff3b1e', glow: 'rgba(255,60,20,0.95)' },
};

export class CountdownSystem extends createSystem({}) {
  private board!: Mesh;
  private canvas!: HTMLCanvasElement;
  private texture!: CanvasTexture;
  private shown = ''; // the message currently drawn on the canvas
  private pop = 0; // 1 → 0 settle animation after each new figure

  init(): void {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 512;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.minFilter = LinearFilter;
    // ~2.6 m wide in the air — reads across the arena, not a HUD chip.
    this.board = new Mesh(
      new PlaneGeometry(2.6, 1.3),
      new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }),
    );
    this.board.visible = false;
    this.scene.add(this.board);
  }

  update(delta: number): void {
    const msg = match.message;
    const style = BEAT_STYLE[msg];
    const active = app.state === 'playing' && !!style;
    this.board.visible = active;
    if (!active) {
      this.shown = '';
      return;
    }

    // "Has the plate decoded yet" folds into the redraw key, so the stencil
    // fallback swaps out for the PNG the moment it's ready (same trick as
    // the HUD scoreboard).
    const art = countdownArt(msg);
    const key = `${msg}|${art ? 'art' : 'txt'}`;
    if (key !== this.shown) {
      const newBeat = !this.shown.startsWith(`${msg}|`);
      this.shown = key;
      if (newBeat) this.pop = 1; // pop on a new figure, not on the art swap-in
      this.draw(msg, art, style.fill, style.glow);
    }
    this.pop = Math.max(0, this.pop - delta * 4);

    // Hang over the centre of the bout: the mean of every platform in MY
    // frame (1v1 → mid-gap, FFA → the cross centre, 2v2 → between the lines),
    // turned upright to face me. The pop eases each figure in oversized.
    const roster = localLayout();
    let cx = 0;
    let cz = 0;
    for (const seat of roster) {
      cx += seat.pos[0];
      cz += seat.pos[2];
    }
    cx /= roster.length;
    cz /= roster.length;
    this.board.position.set(cx, 1.75, cz);
    this.board.rotation.set(0, Math.atan2(-cx, -cz), 0); // +z normal turned to face the origin (me)
    const ease = this.pop * this.pop;
    this.board.scale.setScalar(1 + ease * 0.35);
    (this.board.material as MeshBasicMaterial).opacity = 1 - ease * 0.55;
  }

  private draw(text: string, art: HTMLImageElement | null, fill: string, glow: string): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 1024, 512);
    if (art) {
      // The HUD's neon-metal plate, sized by its visible glyph: digits tall,
      // the FIGHT word wide.
      drawContentPlate(ctx, art, 1024, 512, text.length > 2 ? 310 : 440, 24);
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 ${text.length > 2 ? 240 : 400}px 'Arial Black', system-ui, sans-serif`;
      ctx.lineWidth = 26;
      ctx.strokeStyle = 'rgba(10,11,14,0.95)';
      ctx.strokeText(text, 512, 268);
      ctx.fillStyle = fill;
      ctx.shadowColor = glow;
      ctx.shadowBlur = 46;
      ctx.fillText(text, 512, 268);
    }
    this.texture.needsUpdate = true;
  }
}
