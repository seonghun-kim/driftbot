import type { Snapshot, GameState } from '../sim/types.ts';

export class HUD {
  private container: HTMLElement;
  private itemsEl: HTMLElement;
  private debugEl: HTMLElement;
  private messageEl: HTMLElement;
  private debugVisible = false;
  private lastInventory = -1;
  private lastTick = -1;
  private lastState: GameState = 'PLAYING';

  constructor() {
    this.container = document.getElementById('hud')!;
    this.itemsEl = document.getElementById('hud-items')!;
    this.debugEl = document.getElementById('hud-debug')!;
    this.messageEl = document.getElementById('hud-message')!;
  }

  show(): void {
    this.container.classList.remove('hidden');
    this.lastInventory = -1;
    this.lastTick = -1;
    this.lastState = 'PLAYING';
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
    if (snapshot.player.inventory !== this.lastInventory) {
      this.lastInventory = snapshot.player.inventory;
      this.itemsEl.textContent = `ITEMS: ${this.lastInventory}`;
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
