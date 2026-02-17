import type { PlayerMode } from '../sim/types.ts';
import { DIR_STEPS, DRAG_THRESHOLD } from '../sim/constants.ts';
const TAP_MAX_DIST = 15;

export type DragClassification =
  | { type: 'NONE' }
  | { type: 'PLAYER'; startMode: PlayerMode }
  | { type: 'RESERVE'; segIdx: number; t: number; x: number; y: number; startMode: PlayerMode };

export interface RawGesture {
  type: 'TAP' | 'SHORT_DRAG' | 'LONG_DRAG';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  dirQ: number; // quantized direction (for drags; 0 for taps)
}

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
  private pendingGestures: RawGesture[] = [];
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

  flush(): RawGesture[] {
    const gestures = this.pendingGestures;
    this.pendingGestures = [];
    return gestures;
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

    if (!this.enabled) {
      this._state.dragLength = 0;
      return;
    }

    const dx = this._state.currentX - this._state.startX;
    const dy = this._state.currentY - this._state.startY;
    const length = Math.sqrt(dx * dx + dy * dy);

    const angle = Math.atan2(dy, dx);
    let q = Math.round((angle / (2 * Math.PI)) * DIR_STEPS);
    q = ((q % DIR_STEPS) + DIR_STEPS) % DIR_STEPS;

    if (length < TAP_MAX_DIST) {
      this.pendingGestures.push({
        type: 'TAP',
        startX: this._state.startX,
        startY: this._state.startY,
        endX: this._state.currentX,
        endY: this._state.currentY,
        dirQ: 0,
      });
    } else if (length < DRAG_THRESHOLD) {
      this.pendingGestures.push({
        type: 'SHORT_DRAG',
        startX: this._state.startX,
        startY: this._state.startY,
        endX: this._state.currentX,
        endY: this._state.currentY,
        dirQ: q,
      });
    } else {
      this.pendingGestures.push({
        type: 'LONG_DRAG',
        startX: this._state.startX,
        startY: this._state.startY,
        endX: this._state.currentX,
        endY: this._state.currentY,
        dirQ: q,
      });
    }

    this._state.dragLength = 0;
  };
}
