import type { Snapshot } from '../sim/types.ts';
import type { InputState } from '../input/InputManager.ts';
import { mulberry32 } from '../sim/prng.ts';
import { IMPULSE, PLAYER_MASS, WALL_JUMP_IMPULSE } from '../sim/constants.ts';

const RENDER_SCALE = 0.7;
const MAX_DPR = 1.5;
const CAMERA_LERP = 0.08;
const STAR_COUNT = 60;
const DRAG_THRESHOLD = 40;

interface Star {
  x: number;
  y: number;
  size: number;
  brightness: number;
}

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cameraX = 0;
  private cameraY = 0;
  private stars: Star[] = [];
  private pulsePhase = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.generateStars();
    this.resize();
  }

  private generateStars(): void {
    const rng = mulberry32(12345);
    this.stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      this.stars.push({
        x: rng() * 4000 - 1000,
        y: rng() * 5000 - 1000,
        size: rng() * 2 + 0.5,
        brightness: rng() * 0.6 + 0.4,
      });
    }
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio, MAX_DPR);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.floor(w * dpr * RENDER_SCALE);
    this.canvas.height = Math.floor(h * dpr * RENDER_SCALE);
  }

  draw(snapshot: Snapshot, inputState?: InputState): void {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // Camera follow player
    const targetCX = snapshot.player.x;
    const targetCY = snapshot.player.y;
    this.cameraX += (targetCX - this.cameraX) * CAMERA_LERP;
    this.cameraY += (targetCY - this.cameraY) * CAMERA_LERP;

    // Compute scale: fit ~800 logical units in the smaller screen dimension
    const viewSize = 800;
    const scale = Math.min(cw, ch) / viewSize;

    ctx.clearRect(0, 0, cw, ch);

    // Background
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    // Center camera
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(scale, scale);
    ctx.translate(-this.cameraX, -this.cameraY);

    // Stars (parallax)
    this.drawStars(ctx);

    // World boundary
    this.drawWorldBoundary(ctx, snapshot.worldWidth, snapshot.worldHeight);

    // Internal walls
    for (const w of snapshot.walls) {
      this.drawWall(ctx, w.x, w.y, w.w, w.h);
    }

    // Goals
    for (const g of snapshot.goals) {
      this.drawGoal(ctx, g);
    }

    // Debris
    for (const d of snapshot.debris) {
      if (!d.alive) continue;
      this.drawDebris(ctx, d.x, d.y, d.radius);
    }

    // Player
    this.drawPlayer(ctx, snapshot.player.x, snapshot.player.y, snapshot.player.radius, snapshot.player.wallStuck, snapshot.player.inventory);

    // Drag arrow preview
    if (inputState?.dragging && inputState.dragLength >= DRAG_THRESHOLD) {
      this.drawDragArrow(ctx, snapshot, inputState);
    }

    ctx.restore();

    this.pulsePhase += 0.03;
  }

  resetCamera(x: number, y: number): void {
    this.cameraX = x;
    this.cameraY = y;
  }

  private drawStars(ctx: CanvasRenderingContext2D): void {
    for (const star of this.stars) {
      const flicker = 0.8 + Math.sin(this.pulsePhase * 2 + star.x) * 0.2;
      const alpha = star.brightness * flicker;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawWorldBoundary(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.strokeStyle = 'rgba(80,120,200,0.3)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.strokeRect(0, 0, w, h);
    ctx.setLineDash([]);
  }

  private drawWall(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, 'rgba(80,130,200,0.5)');
    grad.addColorStop(1, 'rgba(50,90,160,0.5)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = 'rgba(120,170,240,0.6)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
  }

  private drawGoal(ctx: CanvasRenderingContext2D, g: { x: number; y: number; radius: number; reached: boolean }): void {
    if (g.reached) {
      // Dim reached goal
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = 'rgba(100, 255, 150, 0.15)';
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(150, 255, 200, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }

    const pulse = 0.4 + Math.sin(this.pulsePhase * 1.5) * 0.2;

    // Outer glow
    const grad = ctx.createRadialGradient(g.x, g.y, g.radius * 0.3, g.x, g.y, g.radius * 1.5);
    grad.addColorStop(0, `rgba(100, 255, 150, ${pulse})`);
    grad.addColorStop(1, 'rgba(100, 255, 150, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.radius * 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Inner circle
    ctx.fillStyle = `rgba(100, 255, 150, ${0.3 + pulse * 0.3})`;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(150, 255, 200, ${0.6 + pulse * 0.2})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
    ctx.stroke();

    // Label
    ctx.fillStyle = `rgba(200, 255, 220, ${0.7 + pulse * 0.2})`;
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('GOAL', g.x, g.y);
  }

  private drawDebris(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
    const isLarge = radius >= 7;
    const colorInner = isLarge ? '#d4a843' : '#c8b860';
    const colorOuter = isLarge ? '#8a6e2f' : '#7a7a3a';
    const grad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, 1, x, y, radius);
    grad.addColorStop(0, colorInner);
    grad.addColorStop(1, colorOuter);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = isLarge ? 'rgba(255,200,100,0.4)' : 'rgba(220,220,120,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, wallStuck: boolean, inventory: number): void {
    // Wall-stuck glow ring
    if (wallStuck) {
      const pulse = 0.5 + Math.sin(this.pulsePhase * 3) * 0.3;
      ctx.strokeStyle = `rgba(255, 220, 100, ${pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Body
    const grad = ctx.createRadialGradient(x - radius * 0.2, y - radius * 0.2, 1, x, y, radius);
    grad.addColorStop(0, '#7ec8e3');
    grad.addColorStop(1, '#3a7ca5');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#a0d8ef';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Eyes
    const eyeOffset = radius * 0.3;
    const eyeRadius = radius * 0.18;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x - eyeOffset, y - eyeOffset * 0.5, eyeRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + eyeOffset, y - eyeOffset * 0.5, eyeRadius, 0, Math.PI * 2);
    ctx.fill();

    // Pupils
    const pupilRadius = eyeRadius * 0.5;
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.arc(x - eyeOffset, y - eyeOffset * 0.5, pupilRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + eyeOffset, y - eyeOffset * 0.5, pupilRadius, 0, Math.PI * 2);
    ctx.fill();

    // Antenna
    ctx.strokeStyle = '#a0d8ef';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - radius);
    ctx.lineTo(x, y - radius - 12);
    ctx.stroke();

    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.arc(x, y - radius - 14, 3, 0, Math.PI * 2);
    ctx.fill();

    // Inventory count on body
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(radius * 0.7)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(inventory), x, y + radius * 0.15);
  }

  private drawArrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number): void {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - size * Math.cos(angle - 0.4), y - size * Math.sin(angle - 0.4));
    ctx.lineTo(x - size * Math.cos(angle + 0.4), y - size * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();
  }

  private drawDragArrow(
    ctx: CanvasRenderingContext2D,
    snapshot: Snapshot,
    input: InputState,
  ): void {
    const dx = input.currentX - input.startX;
    const dy = input.currentY - input.startY;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;

    // Drag direction (normalized)
    const tdx = dx / len;
    const tdy = dy / len;

    const px = snapshot.player.x;
    const py = snapshot.player.y;
    const isWallStuck = snapshot.player.wallStuck;
    const arrowScale = 3;

    if (isWallStuck) {
      // Wall jump: arrow in drag direction, projected to wall-parallel if into wall
      let vx = tdx;
      let vy = tdy;
      const wnx = snapshot.player.wallNx;
      const wny = snapshot.player.wallNy;
      const dot = vx * wnx + vy * wny;
      if (dot < 0) {
        vx -= dot * wnx;
        vy -= dot * wny;
      }
      const vlen = Math.sqrt(vx * vx + vy * vy);
      if (vlen < 0.001) return;
      vx /= vlen;
      vy /= vlen;

      const launchVx = vx * WALL_JUMP_IMPULSE / PLAYER_MASS;
      const launchVy = vy * WALL_JUMP_IMPULSE / PLAYER_MASS;

      const ex = px + launchVx * arrowScale;
      const ey = py + launchVy * arrowScale;
      const angle = Math.atan2(launchVy, launchVx);

      ctx.strokeStyle = 'rgba(255,220,100,0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,220,100,0.8)';
      this.drawArrowHead(ctx, ex, ey, angle, 10);
    } else {
      // Normal throw: recoil direction (opposite of drag)
      const recoilVx = (-tdx * IMPULSE) / PLAYER_MASS;
      const recoilVy = (-tdy * IMPULSE) / PLAYER_MASS;

      // Current velocity
      const cvx = snapshot.player.vx;
      const cvy = snapshot.player.vy;

      // 1) Impulse arrow (yellow)
      const iex = px + recoilVx * arrowScale;
      const iey = py + recoilVy * arrowScale;
      const iAngle = Math.atan2(recoilVy, recoilVx);

      ctx.strokeStyle = 'rgba(255,255,100,0.8)';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(iex, iey);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(255,255,100,0.8)';
      this.drawArrowHead(ctx, iex, iey, iAngle, 10);

      // 2) Combined velocity arrow (cyan)
      const combinedVx = cvx + recoilVx;
      const combinedVy = cvy + recoilVy;
      const combLen = Math.sqrt(combinedVx * combinedVx + combinedVy * combinedVy);
      if (combLen > 0.5) {
        const cex = px + combinedVx * arrowScale;
        const cey = py + combinedVy * arrowScale;
        const cAngle = Math.atan2(combinedVy, combinedVx);

        ctx.strokeStyle = 'rgba(100,220,255,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(cex, cey);
        ctx.stroke();

        ctx.fillStyle = 'rgba(100,220,255,0.7)';
        this.drawArrowHead(ctx, cex, cey, cAngle, 8);
      }
    }
  }
}
