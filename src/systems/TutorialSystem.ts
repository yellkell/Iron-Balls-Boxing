/**
 * The EMBER tutorial — a voiced guide orb (a warm little ball of light, see
 * docs/tutorial-ember.md) walks the player through ignite → throw → recall →
 * a real block drill → a left/right footwork drill → the ball loadout, then a
 * graduation knockdown against a half-health bot.
 *
 * SAFETY: this rides a perfectly ordinary vs-bot duel (app.state 'playing',
 * mode 'bot') and adds NOTHING to any combat system. It only reads/writes
 * SHARED state the combat systems already use — health, the round timer, the
 * opponent command bus — and it does so ONLY while `app.tutorial` is true. In
 * every normal bout that flag is false and this system early-returns on the
 * first line, so the regular game is byte-for-byte untouched. Even the drills
 * observe combat from OUTSIDE: a hit is a health dip against the re-pinned
 * baseline, a block is the lobbed ball dying next to the player without one.
 *
 * How the "pause" works without freezing the engine: during the lesson beats
 * the system (a) clears the bot's queued attacks from the command bus before
 * FireballSystem drains them — so the bot stands and guards but never fires
 * (the drills' lobs are OUR commands, pushed after the purge) — (b) pins both
 * fighters' health (the bot to 55), and (c) keeps the round clock topped up so
 * the round never ends. The player can still orbit, throw and recall freely.
 * Registered just before FireballSystem so its command-bus edits land before
 * the balls are simulated.
 */

import { createSystem, type Entity, InputComponent } from '@iwsdk/core';
import {
  BufferGeometry,
  CanvasTexture,
  Group,
  Line,
  LineBasicMaterial,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  SphereGeometry,
  Sprite,
  Vector3,
} from 'three';
import { Fireball, BallState } from '../components/Fireball.js';
import { Combatant } from '../components/Combatant.js';
import { Health } from '../components/Health.js';
import { match } from '../combat/matchState.js';
import { ballCommands, opponents } from '../combat/opponentBus.js';
import { app } from '../menu/appState.js';
import { startTutorialMusic, stopTutorialMusic } from '../audio/tutorialMusic.js';
import { FIREBALL, MATCH } from '../config.js';
import { UI, buttonPlate, plate, stencilFont } from '../ui/industrial.js';
import { glowSprite } from '../materials/glow.js';
import { emberBurst, spawnEmber } from '../fx/fire.js';
import * as sfx from '../audio/sfx.js';
import {
  preloadTutorVoice,
  sayTutorLine,
  setTutorVoicePosition,
  stopTutorVoice,
  tutorChime,
  tutorVoiceActive,
} from '../audio/tutorVoice.js';
import { updateVoiceListener } from '../pub/voice/playback.js';
import { LINES, PRAISE_POOL, type LineKey } from '../tutorial/script.js';
import { BALL_H, BALL_W, clickBalls, drawBalls } from '../menu/menu.js';

/** The bot's health in tutorial — deliberately low so a beginner can win. */
const TUT_BOT_HP = 55;

/** Where Ember drops below this HP she calls the finish. */
const BOT_WOBBLE_HP = 15;

type Beat = 'attention' | 'ignite' | 'throw' | 'recall' | 'block' | 'move' | 'attach' | 'grad' | 'fight';

// --- Ember's marks (player platform at the origin, facing -Z at the bot) ----
/** The console: a fixed panel anchor off the player's right shoulder. It hosts
 *  the BEGIN button first and the BALL LOADOUT later, so the player learns
 *  where tutorial UI lives before the loadout ever appears. */
const CONSOLE_POS = new Vector3(1.05, 1.3, -0.55);
/** Her graduation-fight perch: up out of the way, still watching. */
const PERCH_POS = new Vector3(1.5, 2.5, -1.9);

// --- canvases ---------------------------------------------------------------
const CAP_W = 768;
const CAP_H = 184;
const CON_W = 384;
const CON_H = 224;
const BEGIN_BTN = { x: 72, y: 116, w: 240, h: 64 };
/** Loadout console canvas: the lobby's 560x480 panel plus a READY footer. */
const LOAD_W = BALL_W;
const LOAD_H = BALL_H + 80;
const READY_BTN = { x: 170, y: BALL_H + 16, w: 220, h: 54 };

/** The four footwork reps: left, right, left, right. */
const MOVE_REPS: ('L' | 'R')[] = ['L', 'R', 'L', 'R'];
/** How far (m) the head must travel along the called side to count. */
const DODGE_DIST = 0.4;

/** The explain line a stalled beat replays (the 14 s "want that again?"). */
const NUDGE_LINE: Partial<Record<Beat, LineKey>> = {
  attention: 'begin',
  ignite: 'igniteRetry',
  throw: 'throwIt',
  recall: 'recall',
  block: 'block',
  move: 'move',
  attach: 'attachList',
};

const UP = new Vector3(0, 1, 0);
const _head = new Vector3();
const _headQ = new Quaternion();
const _fwd = new Vector3();
const _right = new Vector3();
const _v = new Vector3();
const _v2 = new Vector3();
const _origin = new Vector3();
const _dir = new Vector3();
const _end = new Vector3();

interface Pointer {
  line: Line;
  dot: Mesh;
}

interface Panel {
  mesh: Mesh;
  ctx: CanvasRenderingContext2D;
  tex: CanvasTexture;
}

/** What the player's balls did since last frame — combat observed from outside. */
interface BallEvents {
  /** An orbit released too slowly (Orbit → Hover): the punch didn't commit. */
  softRelease: boolean;
  /** A return flight ended in the hand (Returning → Hover/Orbit). */
  caught: boolean;
  /** A DEAD ball was recalled (Dead → Returning) — too late for attachments. */
  lateRecallHand: 0 | 1 | null;
  /** An attachment (or curve) is visibly doing its thing right now. */
  effectLive: boolean;
  anyOrbit: boolean;
  anyFlying: boolean;
}

export class TutorialSystem extends createSystem({
  balls: { required: [Fireball] },
  combatants: { required: [Combatant, Health] },
}) {
  private active = false;
  /** The system's own clock (same idiom as FireballSystem). */
  private time = 0;
  private beat: Beat = 'attention';
  private beatT = 0;
  private sub = 0;
  private subT = 0;

  // --- Ember, the orb ---
  private orb: Group | null = null;
  private halo: Sprite | null = null;
  private core: Sprite | null = null;
  private orbPos = new Vector3();
  private orbTarget = new Vector3();
  private emberAcc = 0;
  private gazeT = 0;

  // --- speech + captions ---
  private caption: Panel | null = null;
  private captionText = '';
  private captionUntil = 0;
  private speakUntil = 0;
  private queue: LineKey[] = [];
  private lastPraise: LineKey | null = null;

  // --- console panels + laser pointers ---
  private console: Panel | null = null;
  private loadout: Panel | null = null;
  private panelHot = false;
  private ray = new Raycaster();
  private pointers: Partial<Record<'left' | 'right', Pointer>> = {};

  // --- the drills' lobbed ball ---
  private lobPending = false;
  private lob: Entity | null = null;
  private lobHand: 0 | 1 = 0;
  private lobT = 0;
  private lobLastPos = new Vector3();

  // --- per-beat progress ---
  private thrown = false;
  private caughtDuringThrow = false;
  private softAt = -99;
  private blocks = 0;
  private lobSpeed = 2.4;
  private repIdx = 0;
  private sideFails = 0;
  private repAxis = new Vector3();
  private repStart = new Vector3();
  private repLive = false;
  private attachBase: [number, number, boolean, boolean] = [0, 0, false, false];
  private attachStage: 'pick' | 'test' = 'pick';
  private effectSeen = false;
  private lateAt = -99;
  private extraPraiseAt = -99;
  private saidFightHit = false;
  private saidFightTaken = false;
  private saidFightLow = false;

  // --- health baselines (hits are read as dips against last frame) ---
  private prevMyHp = 100;
  private prevBotHp = TUT_BOT_HP;

  // --- idle nudges ---
  private waitT = 0;
  private nudgeStage = 0;

  private prevBallState = new Map<Entity, number>();

  update(delta: number): void {
    this.time += delta;
    if (!app.tutorial) {
      if (this.active) this.end();
      return;
    }
    // The bout ended (forfeited, or the match machinery ran out) — leave.
    if (app.state !== 'playing') {
      this.end();
      app.tutorial = false;
      return;
    }
    if (!this.active) this.begin();

    this.beatT += delta;
    this.subT += delta;
    this.playerHead(_head, _headQ);
    _fwd.set(0, 0, -1).applyQuaternion(_headQ);
    _right.set(1, 0, 0).applyQuaternion(_headQ);
    _right.y = 0;
    if (_right.lengthSq() < 1e-4) _right.set(1, 0, 0);
    _right.normalize();

    // Hits are health dips against last frame's (pinned) baseline — combat
    // observed from outside, no hooks in CollisionSystem.
    const myHp = this.fighterHp(0);
    const botHp = this.fighterHp(1);
    const iWasHit = myHp < this.prevMyHp - 0.01;
    const botWasHit = botHp < this.prevBotHp - 0.01;

    const events = this.collectBallEvents();

    if (this.beat === 'fight') {
      this.capBotHealth();
      this.runFight(myHp, botHp, iWasHit, botWasHit);
    } else {
      // Lessons: keep the bout calm and frozen (see header).
      this.suppressBot();
      this.pinHealth();
      match.roundTimer = MATCH.roundTime;
      this.runBeat(delta, events, iWasHit, botWasHit);
    }

    if (!this.active) return; // a win/lose line just ended the tutorial
    this.upkeep(delta);
    this.prevMyHp = this.fighterHp(0);
    this.prevBotHp = this.fighterHp(1);
  }

  // --- the beat machine -------------------------------------------------

  private runBeat(delta: number, events: BallEvents, iWasHit: boolean, botWasHit: boolean): void {
    switch (this.beat) {
      case 'attention':
        this.runAttention();
        break;

      case 'ignite': {
        // She circles the throwing fist, tracing the orbit a ball will take.
        const grip = this.world.playerSpaceEntities.gripSpaces.right?.object3D;
        if (grip) {
          grip.getWorldPosition(this.orbTarget);
          if (this.beatT < 3.5) {
            this.orbTarget.x += Math.cos(this.beatT * 3.2) * 0.22;
            this.orbTarget.y += Math.sin(this.beatT * 3.2) * 0.22;
          } else {
            this.orbTarget.y += 0.28;
          }
        }
        if (events.anyOrbit) {
          this.say('igniteDone');
          this.goto('throw');
        }
        break;
      }

      case 'throw': {
        // She hovers over the bot's head — a living target marker; her voice
        // coming from downrange IS the aim cue.
        this.orbTarget.copy(opponents[0].headPos);
        this.orbTarget.y += 0.5;
        if (events.softRelease && this.time - this.softAt > 3.5) {
          this.softAt = this.time;
          this.say('throwSoft');
        }
        if (events.caught) this.caughtDuringThrow = true;
        if (!this.thrown && events.anyFlying) this.thrown = true;
        if (this.thrown && botWasHit) {
          this.say('throwDone');
          this.goto('recall');
        } else if (this.thrown && !events.anyFlying) {
          // Landed without connecting — the throw still counts.
          this.sayPraise();
          this.goto('recall');
        }
        break;
      }

      case 'recall': {
        // Back to the player's shoulder while the ball flies home.
        this.orbTarget.copy(_head).addScaledVector(_right, 0.45).addScaledVector(_fwd, 0.1);
        this.orbTarget.y -= 0.15;
        if (events.caught) {
          this.say('recallDone');
          this.goto('block');
        }
        break;
      }

      case 'block': {
        // Bodyguard post off the lead shoulder.
        this.orbTarget.copy(_head).addScaledVector(_right, -0.45).addScaledVector(_fwd, 0.2);
        this.orbTarget.y -= 0.2;
        const res = this.resolveLob(delta, iWasHit);
        if (res === 'blocked') {
          this.blocks += 1;
          if (this.blocks === 1) {
            this.say('blockDone'); // "...again, a little faster this time."
            this.lobSpeed = 3.2;
          } else {
            this.say('blockTwo');
            this.goto('move');
          }
        } else if (res === 'hit' || res === 'missed') {
          this.say('blockRetry');
          // Ease off after a failure; the confirmation rep resumes at normal pace.
          this.lobSpeed = this.blocks === 0 ? 2.1 : 2.4;
        }
        // She won't let him throw until the shield exists.
        if (!this.lobLive() && this.speechIdle() && events.anyOrbit) {
          _v.copy(_head);
          _v.y -= 0.35; // mid-chest
          this.pushLob(0, _v, this.lobSpeed);
          this.say('blockIncoming');
        }
        break;
      }

      case 'move': {
        if (this.repLive || this.lobLive()) {
          const res = this.resolveLob(delta, iWasHit);
          if (res) {
            let clean = false;
            if (res === 'missed') {
              // Did the whole body actually go the called way?
              _v.copy(_head).sub(this.repStart);
              _v.y = 0;
              clean = _v.dot(this.repAxis) >= DODGE_DIST;
            }
            this.repLive = false;
            if (clean) {
              this.sideFails = 0;
              this.repIdx += 1;
              if (this.repIdx >= MOVE_REPS.length) {
                this.say('moveDone');
                this.goto('attach');
              } else {
                this.sayPraise();
              }
            } else {
              // Hit, stood still, went the wrong way — or blocked when the
              // lesson was to MOVE. Same side again.
              this.sideFails += 1;
              this.say('moveRetry');
            }
          }
        } else if (this.speechIdle()) {
          // Next rep: she darts to the called side as the visual cue.
          const side = MOVE_REPS[this.repIdx];
          this.repAxis.copy(_right);
          if (side === 'L') this.repAxis.negate();
          this.repStart.copy(_head);
          this.repLive = true;
          // Head-height lob; the bot throws with the hand across from the call.
          this.pushLob(side === 'L' ? 1 : 0, _v.copy(_head), this.sideFails >= 2 ? 2.3 : 2.6);
          this.say(side === 'L' ? 'moveLeft' : 'moveRight');
        } else if (this.repIdx === 0 && this.sideFails === 0) {
          // The explain line: she sweeps the two lanes while the thesis lands.
          this.orbTarget.copy(_head).addScaledVector(_right, Math.sin(this.beatT * 1.6) * 1.3);
          this.orbTarget.y = _head.y;
          break;
        }
        if (this.repLive) {
          // Parked out on the called side until the rep resolves.
          this.orbTarget.copy(_head).addScaledVector(this.repAxis, 1.4).addScaledVector(_fwd, 0.3);
          this.orbTarget.y = _head.y;
        }
        break;
      }

      case 'attach': {
        this.orbTarget.copy(this.attachStage === 'test' && !this.effectSeen ? opponents[0].headPos : CONSOLE_POS);
        this.orbTarget.y += this.attachStage === 'test' && !this.effectSeen ? 0.5 : 0.42;
        this.pollLoadout();
        if (this.attachStage === 'pick' && this.attachChanged()) {
          this.attachStage = 'test';
          this.say('attachTest');
        }
        if (this.attachStage === 'test') {
          if (!this.effectSeen && events.effectLive) {
            this.effectSeen = true;
            this.say('attachDone');
            this.queueLine('attachFree');
          } else if (this.effectSeen && events.effectLive && this.time - this.extraPraiseAt > 5) {
            this.extraPraiseAt = this.time;
            this.sayPraise();
          }
          const late = events.lateRecallHand;
          if (!this.effectSeen && late !== null && (app.ballAttach[late] ?? 0) !== 0 && this.time - this.lateAt > 6) {
            this.lateAt = this.time;
            this.say('attachLate');
          }
        }
        break;
      }

      case 'grad': {
        this.orbTarget.copy(PERCH_POS);
        if (this.speechIdle() && this.beatT > 2) this.goto('fight');
        break;
      }

      case 'fight':
        break; // handled in runFight()
    }
  }

  /** Beat 0 — she does NOT start in front of you. */
  private runAttention(): void {
    app.tutorialHoldFire = true;
    switch (this.sub) {
      case 1: {
        // Drift across the periphery, ~10 o'clock toward 1 o'clock.
        const k = Math.min(1, this.subT / 7);
        _dir.copy(_fwd).applyAxisAngle(UP, 0.95 - k * 1.5);
        this.orbTarget.copy(_head).addScaledVector(_dir, 2.3);
        this.orbTarget.y = _head.y - 0.05;
        if (this.gazeT > 0.4) this.toSub(3);
        else if (this.subT > 4.5) {
          tutorChime();
          this.toSub(2);
        }
        break;
      }
      case 2: {
        // Still nothing? One lap around their head, chiming.
        const phi = this.subT * 2.4;
        this.orbTarget.set(_head.x + Math.sin(phi) * 1.1, _head.y + 0.08, _head.z + Math.cos(phi) * 1.1);
        if (this.gazeT > 0.4 || this.subT > 3.2) this.toSub(3);
        break;
      }
      case 3: {
        // Park dead ahead, flare, say hello.
        this.orbTarget.copy(_head).addScaledVector(_fwd, 1.5);
        this.orbTarget.y = _head.y;
        if (this.orbPos.distanceTo(this.orbTarget) < 0.35) {
          emberBurst(this.orbPos, 14);
          this.say('hello');
          this.toSub(4);
        }
        break;
      }
      case 4: {
        this.orbTarget.copy(_head).addScaledVector(_fwd, 1.5);
        this.orbTarget.y = _head.y;
        if (this.speechIdle()) {
          // She glides to the console and the BEGIN panel fades in beneath
          // her — leading the eye there is the tutorial for where UI lives.
          this.say('begin');
          this.makeConsole();
          this.toSub(5);
        }
        break;
      }
      case 5: {
        this.orbTarget.copy(CONSOLE_POS);
        this.orbTarget.y += 0.35;
        const hit = this.console ? this.pollPanel(this.console.mesh, CON_W, CON_H) : null;
        const over =
          !!hit &&
          hit.x >= BEGIN_BTN.x && hit.x <= BEGIN_BTN.x + BEGIN_BTN.w &&
          hit.y >= BEGIN_BTN.y && hit.y <= BEGIN_BTN.y + BEGIN_BTN.h;
        if (over !== this.panelHot) {
          this.panelHot = over;
          this.drawConsole();
        }
        if (over && hit.clicked) {
          sfx.uiClick();
          tutorChime();
          emberBurst(this.orbPos, 16);
          this.removePanel('console');
          app.tutorialHoldFire = false;
          this.goto('ignite');
        }
        break;
      }
    }
  }

  /** The graduation fight: reactive one-shots from the perch, then the call. */
  private runFight(myHp: number, botHp: number, iWasHit: boolean, botWasHit: boolean): void {
    this.orbTarget.copy(PERCH_POS);
    if (botWasHit && !this.saidFightHit) {
      this.saidFightHit = true;
      this.say('fightHit');
    }
    if (iWasHit && !this.saidFightTaken) {
      this.saidFightTaken = true;
      this.say('fightTaken');
    }
    if (botHp <= BOT_WOBBLE_HP && botHp > 0 && !this.saidFightLow) {
      this.saidFightLow = true;
      this.say('fightLow');
    }
    // One clean knockdown graduates — bow out before the match machinery
    // banks a result, so the tutorial never touches your stats or coins.
    if (botHp <= 0 || myHp <= 0) {
      this.say(botHp <= 0 ? 'win' : 'lose'); // the line outlives the scene
      this.end(false);
      app.tutorial = false;
      app.state = 'menu';
    }
  }

  private goto(beat: Beat): void {
    // A leftover drill ball must not carry across beats.
    if (this.lobLive()) ballCommands.push({ type: 'spend', slot: 0, hand: this.lobHand });
    this.lob = null;
    this.lobPending = false;
    this.beat = beat;
    this.beatT = 0;
    this.toSub(0);
    this.waitT = 0;
    this.nudgeStage = 0;
    switch (beat) {
      case 'ignite':
        this.queueLine('ignite');
        break;
      case 'throw':
        this.thrown = false;
        this.caughtDuringThrow = false;
        this.queueLine('throwIt');
        break;
      case 'recall':
        if (this.caughtDuringThrow) {
          // They recalled and caught before she could ask — roll with it.
          this.queueLine('recallDone');
          this.goto('block');
        } else {
          this.queueLine('recall');
        }
        break;
      case 'block':
        this.blocks = 0;
        this.lobSpeed = 2.4;
        this.queueLine('block');
        break;
      case 'move':
        this.repIdx = 0;
        this.sideFails = 0;
        this.repLive = false;
        this.queueLine('move');
        break;
      case 'attach':
        this.attachStage = 'pick';
        this.effectSeen = false;
        this.attachBase = [app.ballAttach[0] ?? 0, app.ballAttach[1] ?? 0, !!app.ballArc[0], !!app.ballArc[1]];
        this.queueLine('attach');
        this.queueLine('attachList');
        this.makeLoadout();
        break;
      case 'grad':
        this.removePanel('loadout');
        app.tutorialHoldFire = false; // the loadout hover-hold must not linger
        this.queueLine('grad');
        break;
      case 'fight':
        this.saidFightHit = false;
        this.saidFightTaken = false;
        this.saidFightLow = false;
        if (this.halo) this.halo.material.opacity = 0.55; // dimmed to a spark
        break;
    }
  }

  private toSub(sub: number): void {
    this.sub = sub;
    this.subT = 0;
  }

  // --- the lobbed drill ball ----------------------------------------------

  /** Lob one ball from the bot's hand at `target`, gravity-compensated so it
   *  arrives where aimed. Our push lands AFTER suppressBot()'s purge. */
  private pushLob(hand: 0 | 1, target: Vector3, speed: number): void {
    const from = opponents[0].handPos[hand].clone();
    _v2.copy(target).sub(from);
    const dist = _v2.length() || 1;
    const flight = dist / speed;
    const vel = _v2.normalize().multiplyScalar(speed);
    vel.y += 0.5 * FIREBALL.gravity * flight;
    ballCommands.push({ type: 'throw', slot: 0, hand, pos: from, vel: vel.clone() });
    this.lobPending = true;
    this.lob = null;
    this.lobHand = hand;
    this.lobT = 0;
  }

  private lobLive(): boolean {
    return this.lobPending || this.lob !== null;
  }

  /**
   * Watch the lobbed ball to its outcome — combat observed from outside:
   *  - 'hit'      the player's health dipped (the ball found them);
   *  - 'blocked'  the ball died right next to the player without a hit —
   *               only a parry (or a point-blank clash) does that;
   *  - 'missed'   it sailed past, hit a wall, or died out on the floor.
   */
  private resolveLob(delta: number, iWasHit: boolean): 'hit' | 'blocked' | 'missed' | null {
    if (!this.lobLive()) return null;
    this.lobT += delta;

    if (iWasHit) {
      this.lob = null;
      this.lobPending = false;
      return 'hit';
    }

    if (this.lobPending) {
      // FireballSystem turns our command into a Flying owner-1 ball this frame.
      for (const ball of this.queries.balls.entities) {
        if ((ball.getValue(Fireball, 'owner') ?? 0) !== 1) continue;
        if ((ball.getValue(Fireball, 'hand') ?? 0) !== this.lobHand) continue;
        if ((ball.getValue(Fireball, 'state') ?? 0) !== BallState.Flying) continue;
        this.lob = ball;
        this.lobPending = false;
        break;
      }
      if (this.lobPending) {
        if (this.lobT > 1.5) {
          this.lobPending = false;
          return 'missed'; // never spawned (shouldn't happen) — just re-throw
        }
        return null;
      }
    }

    const ball = this.lob!;
    if (!ball.active) {
      this.lob = null;
      return this.lobLastPos.distanceTo(_head) < 1.35 ? 'blocked' : 'missed';
    }
    const obj = ball.object3D;
    if (obj) obj.getWorldPosition(this.lobLastPos);
    const state = ball.getValue(Fireball, 'state') ?? 0;

    if (state === BallState.Dead) {
      this.lob = null;
      // Died close to the player without hurting them = a real block. A floor
      // fizzle at their feet sits well over this radius from the head.
      return this.lobLastPos.distanceTo(_head) < 1.35 ? 'blocked' : 'missed';
    }
    // Sailed past (a dodge, or a whiff): call it and tidy the ball away.
    _v.copy(this.lobLastPos).sub(_head);
    if (state === BallState.Flying && (_v.dot(_fwd) < -0.8 || this.lobT > 6)) {
      ballCommands.push({ type: 'spend', slot: 0, hand: this.lobHand });
      this.lob = null;
      return 'missed';
    }
    return null;
  }

  // --- player-ball events ---------------------------------------------------

  private collectBallEvents(): BallEvents {
    const ev: BallEvents = {
      softRelease: false,
      caught: false,
      lateRecallHand: null,
      effectLive: false,
      anyOrbit: false,
      anyFlying: false,
    };
    const seen = new Map<Entity, number>();
    for (const ball of this.queries.balls.entities) {
      if ((ball.getValue(Fireball, 'owner') ?? 0) !== 0) continue;
      if ((ball.getValue(Fireball, 'shard') ?? 0) === 1) continue;
      const state = ball.getValue(Fireball, 'state') ?? 0;
      const prev = this.prevBallState.get(ball);
      seen.set(ball, state);

      if (state === BallState.Orbit) ev.anyOrbit = true;
      if (state === BallState.Flying) ev.anyFlying = true;
      if (prev === BallState.Orbit && state === BallState.Hover) ev.softRelease = true;
      if (prev === BallState.Returning && (state === BallState.Hover || state === BallState.Orbit)) ev.caught = true;
      if (prev === BallState.Dead && state === BallState.Returning) {
        ev.lateRecallHand = (ball.getValue(Fireball, 'hand') ?? 0) as 0 | 1;
      }
      if (state === BallState.Returning && (ball.getValue(Fireball, 'attach') ?? 0) !== 0) ev.effectLive = true;
      if (state === BallState.Flying) {
        const c = ball.getVectorView(Fireball, 'curl');
        if (Math.hypot(c[0], c[1], c[2]) > 0.25) ev.effectLive = true; // a real curve in flight
      }
    }
    this.prevBallState = seen;
    return ev;
  }

  private attachChanged(): boolean {
    const [a0, a1, c0, c1] = this.attachBase;
    return (
      (app.ballAttach[0] ?? 0) !== a0 ||
      (app.ballAttach[1] ?? 0) !== a1 ||
      !!app.ballArc[0] !== c0 ||
      !!app.ballArc[1] !== c1
    );
  }

  // --- speech ---------------------------------------------------------------

  /** Speak now, hard-stopping the current line; caption mirrors the words.
   *  An interruption means the moment moved on, so pending lines drop too. */
  private say(key: LineKey): void {
    this.queue.length = 0;
    const line = LINES[key];
    const dur = sayTutorLine(line.id, line.text);
    this.captionText = line.text;
    this.captionUntil = this.time + dur + 0.8;
    this.speakUntil = this.time + dur + 0.35;
    this.waitT = 0;
    this.drawCaption();
  }

  /** Speak once the current line (and anything queued before it) finishes. */
  private queueLine(key: LineKey): void {
    this.queue.push(key);
  }

  private speechIdle(): boolean {
    return this.queue.length === 0 && this.time >= this.speakUntil;
  }

  /** A small win that already had its scripted moment — rotate the pool. */
  private sayPraise(): void {
    const picks = PRAISE_POOL.filter((k) => k !== this.lastPraise);
    const key = picks[Math.floor(Math.random() * picks.length)];
    this.lastPraise = key;
    this.say(key);
  }

  // --- per-frame upkeep: orb, captions, panels, nudges ------------------------

  private upkeep(delta: number): void {
    // Speech queue.
    if (this.queue.length && this.time >= this.speakUntil) this.say(this.queue.shift()!);

    // Orb motion: critically-damped chase + idle bob.
    const k = 1 - Math.exp(-5.5 * delta);
    const wasAt = _v2.copy(this.orbPos);
    this.orbPos.lerp(this.orbTarget, k);
    if (this.orb) {
      this.orb.position.copy(this.orbPos);
      this.orb.position.y += Math.sin(this.time * 2.2) * 0.03;
      // She pulses brighter while she talks.
      const talking = tutorVoiceActive() || this.time < this.speakUntil;
      const pulse = talking ? 1 + 0.14 * Math.abs(Math.sin(this.time * 7)) : 1;
      this.halo?.scale.setScalar(0.17 * pulse);
      this.core?.scale.setScalar(0.075 * (talking ? 1 + 0.1 * Math.abs(Math.sin(this.time * 7 + 1)) : 1));
      // Ember trail while she's on the move.
      this.emberAcc += delta;
      if (this.emberAcc > 0.12 && wasAt.distanceTo(this.orbPos) > 0.02) {
        this.emberAcc = 0;
        spawnEmber(this.orb.position, 0.25);
      }
      setTutorVoicePosition(this.orb.position);
    }
    updateVoiceListener(_head, _headQ);

    // Gaze accumulator (attention beat).
    if (this.beat === 'attention') {
      _v.copy(this.orbPos).sub(_head).normalize();
      this.gazeT = _fwd.dot(_v) > 0.92 ? this.gazeT + delta : 0;
    }

    // Caption plate rides under the orb, facing the player.
    if (this.caption) {
      if (this.captionText && this.time > this.captionUntil) {
        this.captionText = '';
        this.drawCaption();
      }
      this.caption.mesh.visible = this.captionText !== '';
      if (this.caption.mesh.visible && this.orb) {
        this.caption.mesh.position.copy(this.orb.position);
        this.caption.mesh.position.y -= 0.3;
        this.caption.mesh.lookAt(_head);
      }
    }

    // Panels face the player.
    for (const p of [this.console, this.loadout]) {
      if (p) p.mesh.lookAt(_head);
    }

    // Idle nudges: 14 s → the beat's explain line again; then → "no rush".
    if (this.beat !== 'fight' && this.beat !== 'grad' && this.speechIdle()) {
      this.waitT += delta;
      const replay = this.beat === 'attach' && this.attachStage === 'test' ? 'attachTest' : NUDGE_LINE[this.beat];
      if (this.nudgeStage === 0 && this.waitT > 14 && replay) {
        this.nudgeStage = 1;
        this.say(replay);
      } else if (this.nudgeStage === 1 && this.waitT > 16) {
        this.nudgeStage = 0;
        this.say('noRush');
      }
    }
  }

  // --- holding the bout calm ------------------------------------------------

  /** Strip the bot's queued attacks before FireballSystem drains them, and
   *  drop its wind-up glow — it stands and guards but never throws. (The
   *  drills' lobs are pushed AFTER this purge, so they survive.) */
  private suppressBot(): void {
    ballCommands.length = 0;
    opponents[0].orbiting[0] = false;
    opponents[0].orbiting[1] = false;
  }

  private pinHealth(): void {
    const me = this.fighter(0);
    const bot = this.fighter(1);
    if (me) me.setValue(Health, 'current', me.getValue(Health, 'max') ?? 100);
    if (bot) bot.setValue(Health, 'current', TUT_BOT_HP);
  }

  /** Cap the bot at half health each frame (so refills between rounds hold the
   *  handicap) while leaving it fully damageable down to a knockout. */
  private capBotHealth(): void {
    const bot = this.fighter(1);
    if (bot) bot.setValue(Health, 'current', Math.min(bot.getValue(Health, 'current') ?? TUT_BOT_HP, TUT_BOT_HP));
  }

  // --- lifecycle --------------------------------------------------------------

  private begin(): void {
    this.active = true;
    this.makeOrb();
    this.makeCaption();
    preloadTutorVoice();

    // She spawns dim, small and OFF-STAGE: ~10 o'clock, edge of the eye.
    this.beat = 'attention';
    this.beatT = 0;
    this.playerHead(_head, _headQ);
    _fwd.set(0, 0, -1).applyQuaternion(_headQ);
    _dir.copy(_fwd).applyAxisAngle(UP, 0.95);
    this.orbPos.copy(_head).addScaledVector(_dir, 2.5);
    this.orbPos.y = _head.y - 0.1;
    this.orbTarget.copy(this.orbPos);
    if (this.orb) this.orb.position.copy(this.orbPos);
    tutorChime();
    this.say('overHere');
    this.toSub(1);
    this.gazeT = 0;

    this.prevMyHp = this.fighterHp(0);
    this.prevBotHp = this.fighterHp(1);
    startTutorialMusic(); // loops for the whole tutorial (lessons + graduation fight)
  }

  private end(stopVoice = true): void {
    if (stopVoice) stopTutorVoice(); // win/lose lines outlive the scene
    this.removeOrb();
    this.removePanel('console');
    this.removePanel('loadout');
    this.removeCaption();
    this.removePointers();
    this.queue.length = 0;
    this.captionText = '';
    this.speakUntil = 0;
    this.prevBallState.clear();
    this.lob = null;
    this.lobPending = false;
    app.tutorialHoldFire = false;
    this.panelHot = false;
    this.waitT = 0;
    this.nudgeStage = 0;
    this.active = false;
    this.beat = 'attention';
    stopTutorialMusic(); // the lobby music fades back up on the way out
  }

  // --- queries --------------------------------------------------------------

  private fighter(slot: number): Entity | undefined {
    for (const e of this.queries.combatants.entities) {
      if ((e.getValue(Combatant, 'slot') ?? -1) === slot) return e;
    }
    return undefined;
  }

  private fighterHp(slot: number): number {
    return this.fighter(slot)?.getValue(Health, 'current') ?? 1;
  }

  private playerHead(outPos: Vector3, outQuat: Quaternion): void {
    const obj = this.playerHeadEntity?.object3D;
    if (obj) {
      obj.getWorldPosition(outPos);
      obj.getWorldQuaternion(outQuat);
    }
  }

  // --- Ember's body -----------------------------------------------------------

  private makeOrb(): void {
    const orb = new Group();
    orb.name = 'ember-orb';
    this.halo = glowSprite(0xffc04d, 0.17, 0.9);
    this.core = glowSprite(0xfff4dc, 0.075, 1);
    this.halo.renderOrder = 22;
    this.core.renderOrder = 23;
    orb.add(this.halo, this.core);
    this.scene.add(orb);
    this.orb = orb;
  }

  private removeOrb(): void {
    if (!this.orb) return;
    this.scene.remove(this.orb);
    this.halo?.material.dispose(); // the radial texture is shared+cached — leave it
    this.core?.material.dispose();
    this.orb = null;
    this.halo = null;
    this.core = null;
  }

  // --- caption plate ----------------------------------------------------------

  private makeCaption(): void {
    this.caption = this.makePanel(CAP_W, CAP_H, 0.68, 'ember-caption');
    this.caption.mesh.visible = false;
  }

  private removeCaption(): void {
    if (!this.caption) return;
    this.disposePanel(this.caption);
    this.caption = null;
  }

  private drawCaption(): void {
    if (!this.caption) return;
    const ctx = this.caption.ctx;
    ctx.clearRect(0, 0, CAP_W, CAP_H);
    if (this.captionText) {
      plate(ctx, 6, 6, CAP_W - 12, CAP_H - 12, {
        cut: 14,
        fill: 'rgba(8,9,13,0.78)',
        stroke: 'rgba(255,192,77,0.55)',
        rivets: false,
      });
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = stencilFont(19);
      ctx.fillStyle = UI.emberBright;
      ctx.fillText('EMBER', 34, 40);
      ctx.font = '600 24px system-ui, sans-serif';
      ctx.fillStyle = UI.text;
      this.wrapCaption(ctx, this.captionText, 34, 72, CAP_W - 68, 30);
    }
    this.caption.tex.needsUpdate = true;
  }

  private wrapCaption(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number): void {
    let line = '';
    let cy = y;
    for (const w of text.split(' ')) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, cy);
        line = w;
        cy += lineH;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, cy);
  }

  // --- the console (BEGIN, then the ball loadout) ------------------------------

  private makePanel(cw: number, ch: number, worldW: number, name: string): Panel {
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d')!;
    const tex = new CanvasTexture(canvas);
    tex.minFilter = LinearFilter;
    const mesh = new Mesh(new PlaneGeometry(worldW, (worldW * ch) / cw), new MeshBasicMaterial({ map: tex, transparent: true }));
    mesh.name = name;
    mesh.renderOrder = 20;
    this.scene.add(mesh);
    return { mesh, ctx, tex };
  }

  private disposePanel(p: Panel): void {
    this.scene.remove(p.mesh);
    p.tex.dispose();
    (p.mesh.material as MeshBasicMaterial).dispose();
    p.mesh.geometry.dispose();
  }

  private makeConsole(): void {
    if (this.console) return;
    this.console = this.makePanel(CON_W, CON_H, 0.44, 'tutorial-console');
    this.console.mesh.position.copy(CONSOLE_POS);
    this.panelHot = false;
    this.drawConsole();
  }

  private drawConsole(): void {
    if (!this.console) return;
    const ctx = this.console.ctx;
    ctx.clearRect(0, 0, CON_W, CON_H);
    plate(ctx, 8, 8, CON_W - 16, CON_H - 16, { cut: 18, fill: 'rgba(10,12,16,0.92)', stroke: UI.emberBright });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = stencilFont(30);
    ctx.fillStyle = UI.emberBright;
    ctx.fillText('TUTORIAL', 36, 66);
    buttonPlate(ctx, BEGIN_BTN.x, BEGIN_BTN.y, BEGIN_BTN.w, BEGIN_BTN.h, 'BEGIN', UI.amber, this.panelHot);
    this.console.tex.needsUpdate = true;
  }

  private makeLoadout(): void {
    if (this.loadout) return;
    this.loadout = this.makePanel(LOAD_W, LOAD_H, 0.62, 'tutorial-loadout');
    this.loadout.mesh.position.copy(CONSOLE_POS);
    this.loadout.mesh.position.y += 0.06;
    this.panelHot = false;
    this.drawLoadout();
  }

  private drawLoadout(): void {
    if (!this.loadout) return;
    const ctx = this.loadout.ctx;
    ctx.clearRect(0, 0, LOAD_W, LOAD_H);
    drawBalls(ctx, null); // the lobby's exact BALL LOADOUT panel, re-hosted
    buttonPlate(ctx, READY_BTN.x, READY_BTN.y, READY_BTN.w, READY_BTN.h, 'READY', UI.emberBright, this.panelHot);
    this.loadout.tex.needsUpdate = true;
  }

  /** Lasers + clicks on the loadout console (Beat 6). */
  private pollLoadout(): void {
    if (!this.loadout) return;
    const hit = this.pollPanel(this.loadout.mesh, LOAD_W, LOAD_H);
    // While a laser is ON the panel the trigger is a mouse, not a match: no
    // igniting or throwing off a loadout tap. Point away and fire is yours.
    app.tutorialHoldFire = hit !== null;
    const overReady =
      !!hit &&
      hit.x >= READY_BTN.x && hit.x <= READY_BTN.x + READY_BTN.w &&
      hit.y >= READY_BTN.y && hit.y <= READY_BTN.y + READY_BTN.h;
    if (overReady !== this.panelHot) {
      this.panelHot = overReady;
      this.drawLoadout();
    }
    if (!hit?.clicked) return;
    if (overReady) {
      sfx.uiClick();
      this.goto('grad');
      return;
    }
    if (hit.y <= BALL_H) {
      // Map into the lobby panel's own coordinate space and share its hit-test.
      if (clickBalls(hit.x / BALL_W, 1 - hit.y / BALL_H)) {
        sfx.uiClick();
        this.drawLoadout();
      }
    }
  }

  /** Aim a laser from each hand at `mesh`; report the hover point (canvas px)
   *  and whether a trigger clicked it this frame. */
  private pollPanel(mesh: Mesh, cw: number, ch: number): { x: number; y: number; clicked: boolean } | null {
    if (!this.pointers.left) this.pointers.left = this.makePointer();
    if (!this.pointers.right) this.pointers.right = this.makePointer();
    let out: { x: number; y: number; clicked: boolean } | null = null;
    for (const hand of ['left', 'right'] as const) {
      const p = this.pointers[hand]!;
      const rayObj = this.world.playerSpaceEntities.raySpaces[hand]?.object3D;
      if (!rayObj) {
        p.line.visible = false;
        p.dot.visible = false;
        continue;
      }
      rayObj.getWorldPosition(_origin);
      rayObj.getWorldDirection(_dir).negate(); // ray space points down −Z
      this.ray.set(_origin, _dir);
      const hit = this.ray.intersectObject(mesh, false)[0];
      _end.copy(hit ? hit.point : _origin.clone().addScaledVector(_dir, 1.6));
      const pos = p.line.geometry.getAttribute('position');
      pos.setXYZ(0, _origin.x, _origin.y, _origin.z);
      pos.setXYZ(1, _end.x, _end.y, _end.z);
      pos.needsUpdate = true;
      p.line.visible = true;
      if (hit?.uv) {
        p.dot.position.copy(hit.point);
        p.dot.visible = true;
        const clicked = this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger) ?? false;
        if (!out || clicked) out = { x: hit.uv.x * cw, y: (1 - hit.uv.y) * ch, clicked };
      } else {
        p.dot.visible = false;
      }
    }
    return out;
  }

  private makePointer(): Pointer {
    const geo = new BufferGeometry().setFromPoints([new Vector3(), new Vector3(0, 0, -1)]);
    const line = new Line(geo, new LineBasicMaterial({ color: 0xffa03c, transparent: true, opacity: 0.85 }));
    line.name = 'tutorial-pointer';
    line.frustumCulled = false;
    line.visible = false;
    line.renderOrder = 21;
    const dot = new Mesh(new SphereGeometry(0.012, 12, 10), new MeshBasicMaterial({ color: 0xffc04d }));
    dot.visible = false;
    dot.renderOrder = 21;
    this.scene.add(line, dot);
    return { line, dot };
  }

  private removePointers(): void {
    for (const hand of ['left', 'right'] as const) {
      const p = this.pointers[hand];
      if (!p) continue;
      this.scene.remove(p.line, p.dot);
      p.line.geometry.dispose();
      (p.line.material as LineBasicMaterial).dispose();
      p.dot.geometry.dispose();
      (p.dot.material as MeshBasicMaterial).dispose();
    }
    this.pointers = {};
  }

  private removePanel(which: 'console' | 'loadout'): void {
    const p = which === 'console' ? this.console : this.loadout;
    if (!p) return;
    this.disposePanel(p);
    if (which === 'console') this.console = null;
    else this.loadout = null;
    // Lasers only exist for a live console.
    if (!this.console && !this.loadout) {
      for (const hand of ['left', 'right'] as const) {
        const ptr = this.pointers[hand];
        if (ptr) {
          ptr.line.visible = false;
          ptr.dot.visible = false;
        }
      }
    }
  }
}
