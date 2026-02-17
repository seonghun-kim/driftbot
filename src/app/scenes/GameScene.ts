import type { Scene } from './SceneManager.ts';
import type { ISim } from '../../sim/ISim.ts';
import type { LevelData, Command, ReplayData, Snapshot } from '../../sim/types.ts';
import { Renderer } from '../../render/Renderer.ts';
import { InputManager, type RawGesture } from '../../input/InputManager.ts';
import { HUD } from '../../ui/HUD.ts';
import { FIXED_DT, DIR_STEPS, FRICTION, WALL_JUMP_SPEED } from '../../sim/constants.ts';
import { findNearestSegment, predictWallCollision, predictJumpLanding } from '../../sim/wallGeometry.ts';

const PREDICTION_NEAR_THRESHOLD = 60;

export class GameScene implements Scene {
  private sim: ISim;
  private renderer: Renderer;
  private input: InputManager;
  private hud: HUD;
  private level: LevelData;
  private seed: number;
  private onEnd: (replay: ReplayData) => void;

  private commandLog: Command[] = [];
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private rafId = 0;
  private endDelay = 0;

  // Drag mode lock: determined at drag start, held until drag ends
  private dragActive = false;
  private dragIsReserve = false;
  private dragReserveSeg = -1;
  private dragReserveT = 0;

  constructor(
    sim: ISim,
    renderer: Renderer,
    input: InputManager,
    hud: HUD,
    level: LevelData,
    seed: number,
    onEnd: (replay: ReplayData) => void,
  ) {
    this.sim = sim;
    this.renderer = renderer;
    this.input = input;
    this.hud = hud;
    this.level = level;
    this.seed = seed;
    this.onEnd = onEnd;
  }

  enter(): void {
    this.sim.reset(this.level, this.seed);
    this.commandLog = [];
    this.accumulator = 0;
    this.lastTime = 0;
    this.endDelay = 0;
    this.running = true;
    this.dragActive = false;

    const snap = this.sim.getSnapshot();
    this.renderer.resetCamera(snap.player.x, snap.player.y);

    this.input.setEnabled(true);
    this.hud.show();
    this.hud.toggleDebug();

    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  exit(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.input.setEnabled(false);
    this.hud.hide();
  }

  update(): void {}
  draw(): void {}

  /** Called each tick to detect drag start and lock the drag mode. */
  private updateDragLock(snapshot: Snapshot): void {
    const inputState = this.input.getInputState();

    if (inputState.dragging && !this.dragActive) {
      // Drag just started — determine mode now and lock it
      this.dragActive = true;
      this.dragIsReserve = false;
      this.dragReserveSeg = -1;

      // Collect all prediction points (primary + chain from JUMP targets)
      const sp = snapshot.player;
      const preds: { wallX: number; wallY: number; segIdx: number; t: number }[] = [];

      const speed = Math.sqrt(sp.vx * sp.vx + sp.vy * sp.vy);
      if (speed > 2) {
        const primary = predictWallCollision(
          sp.x, sp.y, sp.vx, sp.vy, sp.radius,
          FRICTION, FIXED_DT, snapshot.segments, 300,
        );
        if (primary) preds.push(primary);
      }

      // Chain predictions from existing JUMP targets
      for (const target of snapshot.targets) {
        if (target.type !== 'JUMP' || target.dirQ === undefined) continue;
        const chainPred = predictJumpLanding(
          target.x, target.y, target.segIdx, target.dirQ,
          sp.radius, WALL_JUMP_SPEED,
          FRICTION, FIXED_DT, snapshot.segments, 300,
        );
        if (chainPred) preds.push(chainPred);
      }

      // Check if drag start is near any prediction point
      const startWorld = this.renderer.screenToWorld(inputState.startX, inputState.startY);
      for (const pred of preds) {
        const dpx = startWorld.x - pred.wallX;
        const dpy = startWorld.y - pred.wallY;
        const distToPred = Math.sqrt(dpx * dpx + dpy * dpy);
        if (distToPred < PREDICTION_NEAR_THRESHOLD) {
          this.dragIsReserve = true;
          this.dragReserveSeg = pred.segIdx;
          this.dragReserveT = pred.t;
          break;
        }
      }
    }

    if (!inputState.dragging) {
      this.dragActive = false;
    }
  }

  private resolveGestures(gestures: RawGesture[], snapshot: Snapshot, tick: number): Command[] {
    const commands: Command[] = [];
    const mode = snapshot.player.mode;

    for (const g of gestures) {
      if (g.type === 'TAP' && mode === 'WALL') {
        const world = this.renderer.screenToWorld(g.startX, g.startY);
        const nearest = findNearestSegment(world.x, world.y, snapshot.segments);
        if (nearest.segIdx >= 0) {
          const sQ = Math.round(nearest.t * DIR_STEPS);
          commands.push({ type: 'WALL_TAP', tick, segIdx: nearest.segIdx, sQ });
        }
      } else if (g.type === 'LONG_DRAG') {
        // Use the locked drag mode from drag start
        if (this.dragIsReserve && this.dragReserveSeg >= 0) {
          const sQ = Math.round(this.dragReserveT * DIR_STEPS);
          commands.push({
            type: 'WALL_RESERVE_JUMP',
            tick,
            segIdx: this.dragReserveSeg,
            sQ,
            dirQ: g.dirQ,
          });
        } else if (mode === 'SPACE') {
          commands.push({ type: 'THROW', tick, dirQ: g.dirQ });
        } else {
          commands.push({ type: 'WALL_JUMP', tick, dirQ: g.dirQ });
        }
      }
    }

    return commands;
  }

  private loop = (now: number): void => {
    if (!this.running) return;

    const delta = Math.min(now - this.lastTime, 100);
    this.lastTime = now;
    this.accumulator += delta;

    const fixedMs = FIXED_DT * 1000;

    while (this.accumulator >= fixedMs) {
      const snap = this.sim.getSnapshot();

      // Lock drag mode before processing gestures
      this.updateDragLock(snap);

      const gestures = this.input.flush();
      const commands = this.resolveGestures(gestures, snap, snap.tick);

      for (const cmd of commands) {
        this.commandLog.push(cmd);
      }

      this.sim.step(1, commands);
      this.accumulator -= fixedMs;
    }

    const snapshot = this.sim.getSnapshot();
    this.renderer.draw(snapshot, this.input.getInputState());
    this.hud.update(snapshot);

    if (snapshot.state !== 'PLAYING') {
      this.input.setEnabled(false);
      this.endDelay++;
      if (this.endDelay > 90) {
        this.running = false;
        this.onEnd({
          levelId: this.level.id,
          seed: this.seed,
          commands: this.commandLog,
          finalState: snapshot.state,
          finalTick: snapshot.tick,
        });
        return;
      }
    }

    this.rafId = requestAnimationFrame(this.loop);
  };
}
