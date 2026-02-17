import type { Scene } from './SceneManager.ts';
import type { ISim } from '../../sim/ISim.ts';
import type { LevelData, ReplayData } from '../../sim/types.ts';
import type { Renderer } from '../../render/Renderer.ts';

export class ResultScene implements Scene {
  private overlay: HTMLElement;
  private sim: ISim;
  private renderer: Renderer;
  private replay: ReplayData;
  private level: LevelData;
  private stageNum: number;
  private totalStages: number;
  private onRestart: () => void;
  private onNext?: () => void;

  constructor(
    sim: ISim,
    renderer: Renderer,
    replay: ReplayData,
    level: LevelData,
    stageNum: number,
    totalStages: number,
    onRestart: () => void,
    onNext?: () => void,
  ) {
    this.sim = sim;
    this.renderer = renderer;
    this.replay = replay;
    this.level = level;
    this.stageNum = stageNum;
    this.totalStages = totalStages;
    this.onRestart = onRestart;
    this.onNext = onNext;
    this.overlay = document.getElementById('scene-overlay')!;
  }

  enter(): void {
    const isSuccess = this.replay.finalState === 'SUCCESS';
    const isFinalClear = isSuccess && !this.onNext;

    let statusText: string;
    if (isFinalClear) {
      statusText = 'ALL CLEAR!';
    } else if (isSuccess) {
      statusText = `STAGE ${this.stageNum} CLEAR!`;
    } else {
      statusText = `STAGE ${this.stageNum} FAIL`;
    }

    const nextBtn = this.onNext
      ? `<button id="btn-next">NEXT STAGE</button>`
      : '';

    this.overlay.classList.remove('hidden');
    this.overlay.innerHTML = `
      <div class="result-status ${isSuccess ? 'success' : 'fail'}">
        ${statusText}
      </div>
      <div class="subtitle">
        Stage ${this.stageNum}/${this.totalStages} | Throws: ${this.replay.commands.length} | Ticks: ${this.replay.finalTick}
      </div>
      ${nextBtn}
      <button id="btn-replay">REPLAY</button>
      <button id="btn-restart">RESTART</button>
    `;

    if (this.onNext) {
      document.getElementById('btn-next')!.addEventListener('click', () => {
        this.onNext!();
      });
    }

    document.getElementById('btn-replay')!.addEventListener('click', () => {
      this.runReplay();
    });
    document.getElementById('btn-restart')!.addEventListener('click', () => {
      this.onRestart();
    });
  }

  exit(): void {
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
  }

  update(): void {}

  draw(): void {
    const canvas = this.renderer['canvas'] as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  private runReplay(): void {
    const statusEl = this.overlay.querySelector('.subtitle')!;
    statusEl.textContent = 'Replaying...';

    setTimeout(() => {
      this.sim.reset(this.level, this.replay.seed);

      const maxTick = this.replay.finalTick;
      for (let t = 0; t < maxTick; t++) {
        const cmds = this.replay.commands.filter((c) => c.tick === t);
        this.sim.step(1, cmds);
      }

      const snap = this.sim.getSnapshot();
      const match = snap.state === this.replay.finalState;

      if (match) {
        statusEl.textContent = `Replay Verified! (${this.replay.commands.length} throws, ${this.replay.finalTick} ticks)`;
        (statusEl as HTMLElement).style.color = '#4f4';
      } else {
        statusEl.textContent = `Replay MISMATCH! Expected ${this.replay.finalState}, got ${snap.state}`;
        (statusEl as HTMLElement).style.color = '#f44';
      }
    }, 50);
  }
}
