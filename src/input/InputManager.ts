import type { Command } from '../sim/types.ts';
import { DIR_STEPS } from '../sim/constants.ts';

const DRAG_THRESHOLD = 40;

export interface InputState {
  dragging: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  dragLength: number;
}

export class InputManager {
  private canvas: HTMLCanvasElement;
  private pendingCommands: Command[] = [];
  private currentTick = 0;
  private _state: InputState = {
    dragging: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    dragLength: 0,
  };
  private enabled = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  setTick(tick: number): void {
    this.currentTick = tick;
  }

  flush(): Command[] {
    const cmds = this.pendingCommands;
    this.pendingCommands = [];
    for (const cmd of cmds) {
      cmd.tick = this.currentTick;
    }
    return cmds;
  }

  getInputState(): InputState {
    return { ...this._state };
  }

  destroy(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    this._state.dragging = true;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    this._state.startX = e.clientX;
    this._state.startY = e.clientY;
    this._state.currentX = e.clientX;
    this._state.currentY = e.clientY;
    this._state.dragLength = 0;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this._state.dragging) return;
    e.preventDefault();
    this._state.currentX = e.clientX;
    this._state.currentY = e.clientY;
    const dx = this._state.currentX - this._state.startX;
    const dy = this._state.currentY - this._state.startY;
    this._state.dragLength = Math.sqrt(dx * dx + dy * dy);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this._state.dragging) return;
    e.preventDefault();
    this._state.dragging = false;

    const dx = this._state.currentX - this._state.startX;
    const dy = this._state.currentY - this._state.startY;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length >= DRAG_THRESHOLD && this.enabled) {
      const angle = Math.atan2(dy, dx);
      let q = Math.round((angle / (2 * Math.PI)) * DIR_STEPS);
      q = ((q % DIR_STEPS) + DIR_STEPS) % DIR_STEPS;

      this.pendingCommands.push({
        type: 'THROW',
        tick: this.currentTick,
        dirQ: q,
      });
    }

    this._state.dragLength = 0;
  };
}
