import type { Snapshot, GameState, PlayerMode } from '../sim/types.ts';

export class HUD {
  private container: HTMLElement;
  private itemsEl: HTMLElement;
  private corridorEl: HTMLElement;
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
  private lastCorridorText = '';

  constructor() {
    this.container = document.getElementById('hud')!;
    this.itemsEl = document.getElementById('hud-items')!;
    this.corridorEl = document.getElementById('hud-corridor')!;
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
    this.lastCorridorText = '';
    this.corridorEl.textContent = '';
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
    const isCorridor = !!snapshot.corridor;

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

      const modeLabel = mode === 'WALL' ? 'WALL' : 'SPACE';
      const targetInfo = mode === 'WALL' && targetCount > 0 ? ` TGT:${targetCount}` : '';

      if (isCorridor) {
        this.itemsEl.textContent = `${modeLabel} | ITEMS: ${this.lastInventory}${targetInfo}`;
      } else {
        const goalsTotal = snapshot.goals.length;
        this.itemsEl.textContent = `${modeLabel} | ITEMS: ${this.lastInventory}  GOALS: ${goalsReached}/${goalsTotal}${targetInfo}`;
      }
    }

    // Corridor-specific HUD
    if (isCorridor) {
      const c = snapshot.corridor!;
      const allUnlocked = c.gates.every((g) => g.unlocked);
      let corridorText: string;

      if (allUnlocked) {
        corridorText = 'EXIT ^';
      } else if (c.subWorld !== 'corridor') {
        const gate = c.gates[c.subWorld as number];
        corridorText = `[EVA] COLLECT: ${gate.collectedItems}/${gate.requiredItems}`;
      } else {
        const gate = c.gates[c.currentGate];
        corridorText = `GATE ${c.currentGate + 1}/${c.gates.length} | COLLECT: ${gate.collectedItems}/${gate.requiredItems}`;
      }

      if (corridorText !== this.lastCorridorText) {
        this.lastCorridorText = corridorText;
        this.corridorEl.textContent = corridorText;
      }
    } else if (this.lastCorridorText !== '') {
      this.lastCorridorText = '';
      this.corridorEl.textContent = '';
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
