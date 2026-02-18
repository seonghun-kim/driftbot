import type { Scene } from './SceneManager.ts';
import type { ISim } from '../../sim/ISim.ts';
import type { LevelData, Command, ReplayData, Snapshot } from '../../sim/types.ts';
import { Renderer } from '../../render/Renderer.ts';
import { InputManager, type RawGesture, type DragClassification } from '../../input/InputManager.ts';
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
  private paused = false;
  private rafId = 0;
  private endDelay = 0;

  // Drag classification: determined at drag start, locked until drag ends
  private dragClassification: DragClassification = { type: 'NONE' };

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
    this.dragClassification = { type: 'NONE' };

    const snap = this.sim.getSnapshot();
    this.renderer.resetCamera(snap.player.x, snap.player.y);

    this.paused = false;
    this.input.setEnabled(true);
    this.hud.show();
    this.hud.toggleDebug();
    this.hud.setPaused(false);
    this.hud.setPauseCallback(() => this.togglePause());

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

  /** Called each frame to detect drag start and lock the drag classification. */
  private updateDragLock(snapshot: Snapshot): void {
    const inputState = this.input.getInputState();

    // Drag released → reset
    if (!inputState.dragging) {
      this.dragClassification = { type: 'NONE' };
      return;
    }

    // Already classified → keep locked
    if (this.dragClassification.type !== 'NONE') return;

    // New drag — classify now
    const sp = snapshot.player;
    const startWorld = this.renderer.screenToWorld(inputState.startX, inputState.startY);
    const startMode = sp.mode;

    // Collect all prediction points (primary + chain from JUMP targets)
    const preds: { wallX: number; wallY: number; segIdx: number; t: number }[] = [];

    const speed = Math.sqrt(sp.vx * sp.vx + sp.vy * sp.vy);
    if (speed > 2) {
      const primary = predictWallCollision(
        sp.x, sp.y, sp.vx, sp.vy, sp.radius,
        FRICTION, FIXED_DT, snapshot.segments,
      );
      if (primary) preds.push(primary);
    }

    for (const target of snapshot.targets) {
      if (target.type !== 'JUMP' || target.dirQ === undefined) continue;
      const chainPred = predictJumpLanding(
        target.x, target.y, target.segIdx, target.dirQ,
        sp.radius, WALL_JUMP_SPEED,
        FRICTION, FIXED_DT, snapshot.segments,
      );
      if (chainPred) preds.push(chainPred);
    }

    // Find closest prediction point to drag start
    let bestDist = Infinity;
    let bestPred: { wallX: number; wallY: number; segIdx: number; t: number } | null = null;
    for (const pred of preds) {
      const dpx = startWorld.x - pred.wallX;
      const dpy = startWorld.y - pred.wallY;
      const dist = Math.sqrt(dpx * dpx + dpy * dpy);
      if (dist < PREDICTION_NEAR_THRESHOLD && dist < bestDist) {
        bestDist = dist;
        bestPred = pred;
      }
    }

    if (bestPred) {
      this.dragClassification = {
        type: 'RESERVE',
        segIdx: bestPred.segIdx,
        t: bestPred.t,
        x: bestPred.wallX,
        y: bestPred.wallY,
        startMode,
      };
      return;
    }

    // Check if drag started near the player
    const dpPlayer = Math.sqrt(
      (startWorld.x - sp.x) ** 2 + (startWorld.y - sp.y) ** 2,
    );
    if (dpPlayer < PREDICTION_NEAR_THRESHOLD) {
      this.dragClassification = { type: 'PLAYER', startMode };
      return;
    }

    // Neither reserve nor player → stays NONE (no gizmo, no command)
  }

  private togglePause(): void {
    this.paused = !this.paused;
    if (this.paused) {
      this.accumulator = 0;
    }
    this.hud.setPaused(this.paused);
  }

  private resolveGesturesPaused(gestures: RawGesture[], _snapshot: Snapshot, tick: number): Command[] {
    const commands: Command[] = [];
    const dc = this.dragClassification;

    for (const g of gestures) {
      // Only allow WALL_RESERVE_JUMP during pause
      if (g.type === 'LONG_DRAG' && dc.type === 'RESERVE') {
        const endWorld = this.renderer.screenToWorld(g.endX, g.endY);
        const rdx = endWorld.x - dc.x;
        const rdy = endWorld.y - dc.y;
        const rAngle = Math.atan2(rdy, rdx);
        let reserveDirQ = Math.round((rAngle / (2 * Math.PI)) * DIR_STEPS);
        reserveDirQ = ((reserveDirQ % DIR_STEPS) + DIR_STEPS) % DIR_STEPS;

        const sQ = Math.round(dc.t * DIR_STEPS);
        commands.push({
          type: 'WALL_RESERVE_JUMP',
          tick,
          segIdx: dc.segIdx,
          sQ,
          dirQ: reserveDirQ,
        });
      }
      // TAP, THROW, WALL_JUMP, WALL_TAP → all blocked
    }

    return commands;
  }

  private resolveGestures(gestures: RawGesture[], snapshot: Snapshot, tick: number): Command[] {
    const commands: Command[] = [];
    const dc = this.dragClassification;
    const liveMode = snapshot.player.mode;

    for (const g of gestures) {
      if (g.type === 'TAP' && liveMode === 'WALL') {
        const world = this.renderer.screenToWorld(g.startX, g.startY);
        const nearest = findNearestSegment(world.x, world.y, snapshot.segments);
        if (nearest.segIdx >= 0) {
          const sQ = Math.round(nearest.t * DIR_STEPS);
          commands.push({ type: 'WALL_TAP', tick, segIdx: nearest.segIdx, sQ });
        }
      } else if (g.type === 'LONG_DRAG') {
        if (dc.type === 'RESERVE') {
          // Direction: from reserve point toward drag end (world space)
          const endWorld = this.renderer.screenToWorld(g.endX, g.endY);
          const rdx = endWorld.x - dc.x;
          const rdy = endWorld.y - dc.y;
          const rAngle = Math.atan2(rdy, rdx);
          let reserveDirQ = Math.round((rAngle / (2 * Math.PI)) * DIR_STEPS);
          reserveDirQ = ((reserveDirQ % DIR_STEPS) + DIR_STEPS) % DIR_STEPS;

          const sQ = Math.round(dc.t * DIR_STEPS);
          commands.push({
            type: 'WALL_RESERVE_JUMP',
            tick,
            segIdx: dc.segIdx,
            sQ,
            dirQ: reserveDirQ,
          });
        } else if (dc.type === 'PLAYER') {
          if (dc.startMode === 'SPACE') {
            commands.push({ type: 'THROW', tick, dirQ: g.dirQ });
          } else {
            commands.push({ type: 'WALL_JUMP', tick, dirQ: g.dirQ });
          }
        }
        // dc.type === 'NONE' → no command
      }
    }

    return commands;
  }

  private loop = (now: number): void => {
    if (!this.running) return;

    if (this.paused) {
      this.lastTime = now;

      let snap = this.sim.getSnapshot();
      const gestures = this.input.flush();
      const commands = this.resolveGesturesPaused(gestures, snap, snap.tick);

      if (commands.length > 0) {
        this.commandLog.push(...commands);
        this.sim.step(1, commands);
        snap = this.sim.getSnapshot();
      }

      this.updateDragLock(snap);
      this.renderer.draw(snap, this.input.getInputState(), this.dragClassification, true);
      this.hud.update(snap);
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }

    const delta = Math.min(now - this.lastTime, 100);
    this.lastTime = now;
    this.accumulator += delta;

    const fixedMs = FIXED_DT * 1000;

    while (this.accumulator >= fixedMs) {
      const snap = this.sim.getSnapshot();

      const gestures = this.input.flush();
      const commands = this.resolveGestures(gestures, snap, snap.tick);

      for (const cmd of commands) {
        this.commandLog.push(cmd);
      }

      this.sim.step(1, commands);
      this.accumulator -= fixedMs;
    }

    const snapshot = this.sim.getSnapshot();

    // Classify drag once per frame, after sim ticks (guarantees execution even at 120Hz)
    this.updateDragLock(snapshot);

    this.renderer.draw(snapshot, this.input.getInputState(), this.dragClassification);
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
