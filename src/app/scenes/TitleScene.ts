import type { Scene } from './SceneManager.ts';
import type { Renderer } from '../../render/Renderer.ts';

export class TitleScene implements Scene {
  private overlay: HTMLElement;
  private onStart: () => void;
  private renderer: Renderer;

  constructor(
    renderer: Renderer,
    onStart: () => void,
  ) {
    this.renderer = renderer;
    this.onStart = onStart;
    this.overlay = document.getElementById('scene-overlay')!;
  }

  enter(): void {
    this.overlay.classList.remove('hidden');
    this.overlay.innerHTML = `
      <div class="title">DRIFTBOT</div>
      <div class="subtitle">Throw to drift. Drift to survive.</div>
      <button id="btn-start">START</button>
    `;
    document.getElementById('btn-start')!.addEventListener('click', () => {
      this.onStart();
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
}
