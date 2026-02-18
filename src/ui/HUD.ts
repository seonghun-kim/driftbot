import type { Snapshot, GameState, PlayerMode } from '../sim/types.ts';

export class HUD {
  private container: HTMLElement;
  private itemsEl: HTMLElement;
  private debugEl: HTMLElement;
  private messageEl: HTMLElement;
  private pauseBtn: HTMLButtonElement;
  private debugVisible = false;
  private lastInventory = -1;
  private lastGoalsReached = -1;
  private lastTick = -1;
  private lastState: GameState = 'PLAYING';
  private lastMode: PlayerMode | null = null;
  private lastTargetCount = -1;

  constructor() {
    this.container = document.getElementById('hud')!;
    this.itemsEl = document.getElementById('hud-items')!;
    this.debugEl = document.getElementById('hud-debug')!;
    this.messageEl = document.getElementById('hud-message')!;
    this.pauseBtn = document.getElementById('hud-pause') as HTMLButtonElement;
  }

  setPauseCallback(cb: () => void): void {
    this.pauseBtn.addEventListener('click', cb);
  }

  setPaused(paused: boolean): void {
    this.pauseBtn.textContent = paused ? '▶' : '⏸';
    if (paused) {
      this.messageEl.textContent = 'PAUSED';
      this.messageEl.style.display = 'block';
      this.messageEl.style.color = 'rgba(255,255,255,0.7)';
    } else {
      // Only hide if still showing PAUSED (don't hide SUCCESS/FAIL)
      if (this.messageEl.textContent === 'PAUSED') {
        this.messageEl.style.display = 'none';
      }
    }
  }

  show(): void {
    this.container.classList.remove('hidden');
    this.lastInventory = -1;
    this.lastGoalsReached = -1;
    this.lastTick = -1;
    this.lastState = 'PLAYING';
    this.lastMode = null;
    this.lastTargetCount = -1;
    this.messageEl.style.display = 'none';
  }

  hide(): void {
    this.container.classList.add('hidden');
  }

  toggleDebug(): void {
    this.debugVisible = !this.debugVisible;
    this.debugEl.style.display = this.debugVisible ? 'inline' : 'none';
  }

  update(snapshot: Snapshot): void {
    const goalsReached = snapshot.goals.filter((g) => g.reached).length;
    const mode = snapshot.player.mode;
    const targetCount = snapshot.targets.length;

    if (
      snapshot.player.inventory !== this.lastInventory ||
      goalsReached !== this.lastGoalsReached ||
      mode !== this.lastMode ||
      targetCount !== this.lastTargetCount
    ) {
      this.lastInventory = snapshot.player.inventory;
      this.lastGoalsReached = goalsReached;
      this.lastMode = mode;
      this.lastTargetCount = targetCount;

      const goalsTotal = snapshot.goals.length;
      const modeLabel = mode === 'WALL' ? 'WALL' : 'SPACE';
      const targetInfo = mode === 'WALL' && targetCount > 0 ? ` TGT:${targetCount}` : '';
      this.itemsEl.textContent = `${modeLabel} | ITEMS: ${this.lastInventory}  GOALS: ${goalsReached}/${goalsTotal}${targetInfo}`;
    }

    if (this.debugVisible && snapshot.tick !== this.lastTick) {
      this.lastTick = snapshot.tick;
      const speed = Math.sqrt(snapshot.player.vx ** 2 + snapshot.player.vy ** 2);
      this.debugEl.textContent = `T:${snapshot.tick} V:${speed.toFixed(1)}`;
    }

    if (snapshot.state !== this.lastState) {
      this.lastState = snapshot.state;
      if (snapshot.state === 'SUCCESS') {
        this.messageEl.textContent = 'SUCCESS!';
        this.messageEl.style.display = 'block';
        this.messageEl.style.color = '#4f4';
      } else if (snapshot.state === 'FAIL') {
        this.messageEl.textContent = 'FAIL';
        this.messageEl.style.display = 'block';
        this.messageEl.style.color = '#f44';
      }
    }
  }
}
