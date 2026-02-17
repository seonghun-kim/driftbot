import type { Scene } from './SceneManager.ts';
import type { ISim } from '../../sim/ISim.ts';
import type { LevelData, Command, ReplayData } from '../../sim/types.ts';
import { Renderer } from '../../render/Renderer.ts';
import { InputManager } from '../../input/InputManager.ts';
import { HUD } from '../../ui/HUD.ts';
import { FIXED_DT } from '../../sim/constants.ts';

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

  private loop = (now: number): void => {
    if (!this.running) return;

    const delta = Math.min(now - this.lastTime, 100);
    this.lastTime = now;
    this.accumulator += delta;

    const fixedMs = FIXED_DT * 1000;

    while (this.accumulator >= fixedMs) {
      const snap = this.sim.getSnapshot();
      this.input.setTick(snap.tick);

      const commands = this.input.flush();
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
