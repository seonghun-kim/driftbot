import type { Snapshot, Segment, SnapshotTarget } from '../sim/types.ts';
import type { InputState } from '../input/InputManager.ts';
import { mulberry32 } from '../sim/prng.ts';
import { IMPULSE, PLAYER_MASS, DIR_STEPS, FRICTION, FIXED_DT, WALL_JUMP_SPEED } from '../sim/constants.ts';
import { predictWallCollision, predictJumpLanding } from '../sim/wallGeometry.ts';

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
  private scale = 1;
  private prediction: { wallX: number; wallY: number; segIdx: number; t: number } | null = null;
  private allPredictions: { wallX: number; wallY: number; segIdx: number; t: number }[] = [];
  // Drag mode lock: captured at drag start, held until drag ends
  private wasDragging = false;
  private dragReservePoint: { x: number; y: number; segIdx: number } | null = null;

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

  /** Convert screen (client) coordinates to world coordinates. */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // Account for CSS sizing vs canvas pixel sizing
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    const pixelX = (sx / cssW) * cw;
    const pixelY = (sy / cssH) * ch;

    const viewSize = 800;
    const scale = Math.min(cw, ch) / viewSize;

    // Reverse the camera transform: translate(cw/2, ch/2) → scale → translate(-camX, -camY)
    const worldX = (pixelX - cw / 2) / scale + this.cameraX;
    const worldY = (pixelY - ch / 2) / scale + this.cameraY;

    return { x: worldX, y: worldY };
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

    const viewSize = 800;
    this.scale = Math.min(cw, ch) / viewSize;

    ctx.clearRect(0, 0, cw, ch);

    // Background
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.cameraX, -this.cameraY);

    // Stars (parallax)
    this.drawStars(ctx);

    // World boundary (first 4 segments are boundary)
    this.drawWorldBoundary(ctx, snapshot.worldWidth, snapshot.worldHeight);

    // Internal wall segments (index 4+)
    for (let i = 4; i < snapshot.segments.length; i++) {
      this.drawSegment(ctx, snapshot.segments[i]);
    }

    // Targets
    for (const t of snapshot.targets) {
      this.drawTarget(ctx, t, snapshot.segments);
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
    this.drawPlayer(ctx, snapshot);

    // Predict wall collision (when player has meaningful velocity)
    const sp = snapshot.player;
    const speed = Math.sqrt(sp.vx * sp.vx + sp.vy * sp.vy);
    if (speed > 2) {
      this.prediction = predictWallCollision(
        sp.x, sp.y, sp.vx, sp.vy, sp.radius,
        FRICTION, FIXED_DT, snapshot.segments, 300,
      );
    } else {
      this.prediction = null;
    }

    // Collect all prediction points (primary + chain from JUMP targets)
    this.allPredictions = [];
    if (this.prediction) {
      this.allPredictions.push(this.prediction);
    }

    // Chain predictions for each JUMP target
    const chainPreds: { fromX: number; fromY: number; pred: { wallX: number; wallY: number; segIdx: number; t: number } }[] = [];
    for (const target of snapshot.targets) {
      if (target.type !== 'JUMP' || target.dirQ === undefined) continue;
      const pred = predictJumpLanding(
        target.x, target.y, target.segIdx, target.dirQ,
        sp.radius, WALL_JUMP_SPEED,
        FRICTION, FIXED_DT, snapshot.segments, 300,
      );
      if (pred) {
        chainPreds.push({ fromX: target.x, fromY: target.y, pred });
        this.allPredictions.push(pred);
      }
    }

    // Draw primary prediction
    if (this.prediction) {
      this.drawPredictionMarker(ctx, sp.x, sp.y, this.prediction.wallX, this.prediction.wallY);
    }

    // Draw chain predictions
    for (const cp of chainPreds) {
      this.drawPredictionMarker(ctx, cp.fromX, cp.fromY, cp.pred.wallX, cp.pred.wallY);
    }

    // Drag mode lock: capture reserve point at drag start, hold until drag ends
    const isDragging = !!inputState?.dragging;
    if (isDragging && !this.wasDragging && inputState) {
      // Drag just started — check if near any prediction point
      const startWorld = this.screenToWorld(inputState.startX, inputState.startY);
      this.dragReservePoint = null;
      for (const pred of this.allPredictions) {
        const dpx = startWorld.x - pred.wallX;
        const dpy = startWorld.y - pred.wallY;
        const distToPred = Math.sqrt(dpx * dpx + dpy * dpy);
        if (distToPred < 60) {
          this.dragReservePoint = { x: pred.wallX, y: pred.wallY, segIdx: pred.segIdx };
          break;
        }
      }
    }
    if (!isDragging) {
      this.dragReservePoint = null;
    }
    this.wasDragging = isDragging;

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

  private drawSegment(ctx: CanvasRenderingContext2D, seg: Segment): void {
    // Thick glowing line
    ctx.save();

    // Outer glow
    ctx.strokeStyle = 'rgba(80,130,200,0.3)';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(seg.ax, seg.ay);
    ctx.lineTo(seg.bx, seg.by);
    ctx.stroke();

    // Core line
    ctx.strokeStyle = 'rgba(120,170,240,0.7)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(seg.ax, seg.ay);
    ctx.lineTo(seg.bx, seg.by);
    ctx.stroke();

    // Bright center
    ctx.strokeStyle = 'rgba(180,210,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(seg.ax, seg.ay);
    ctx.lineTo(seg.bx, seg.by);
    ctx.stroke();

    ctx.restore();
  }

  private drawTarget(ctx: CanvasRenderingContext2D, target: SnapshotTarget, _segments: Segment[]): void {
    const x = target.x;
    const y = target.y;

    if (target.type === 'MOVE') {
      // Green dot on wall
      ctx.fillStyle = 'rgba(100, 255, 150, 0.8)';
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();

      // Glow
      ctx.strokeStyle = 'rgba(100, 255, 150, 0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // Jump target: orange dot + arrow
      const pulse = 0.6 + Math.sin(this.pulsePhase * 3) * 0.3;

      ctx.fillStyle = `rgba(255, 180, 80, ${pulse})`;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(255, 180, 80, ${pulse * 0.6})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.stroke();

      // Arrow showing jump direction
      if (target.dirQ !== undefined) {
        const angle = (target.dirQ / DIR_STEPS) * 2 * Math.PI;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const arrowLen = 25;

        ctx.strokeStyle = `rgba(255, 220, 100, ${pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + dx * arrowLen, y + dy * arrowLen);
        ctx.stroke();

        ctx.fillStyle = `rgba(255, 220, 100, ${pulse})`;
        this.drawArrowHead(ctx, x + dx * arrowLen, y + dy * arrowLen, angle, 8);
      }
    }
  }

  private drawGoal(ctx: CanvasRenderingContext2D, g: { x: number; y: number; radius: number; reached: boolean }): void {
    if (g.reached) {
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

    const grad = ctx.createRadialGradient(g.x, g.y, g.radius * 0.3, g.x, g.y, g.radius * 1.5);
    grad.addColorStop(0, `rgba(100, 255, 150, ${pulse})`);
    grad.addColorStop(1, 'rgba(100, 255, 150, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.radius * 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(100, 255, 150, ${0.3 + pulse * 0.3})`;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(150, 255, 200, ${0.6 + pulse * 0.2})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
    ctx.stroke();

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

  private drawPlayer(ctx: CanvasRenderingContext2D, snapshot: Snapshot): void {
    const { x, y, radius, mode, inventory } = snapshot.player;
    const isWall = mode === 'WALL';

    // Mode-specific glow ring
    if (isWall) {
      const pulse = 0.5 + Math.sin(this.pulsePhase * 3) * 0.3;
      ctx.strokeStyle = `rgba(255, 220, 100, ${pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Body
    const bodyColor1 = isWall ? '#e3c87e' : '#7ec8e3';
    const bodyColor2 = isWall ? '#a58c3a' : '#3a7ca5';
    const grad = ctx.createRadialGradient(x - radius * 0.2, y - radius * 0.2, 1, x, y, radius);
    grad.addColorStop(0, bodyColor1);
    grad.addColorStop(1, bodyColor2);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    const strokeColor = isWall ? '#efd8a0' : '#a0d8ef';
    ctx.strokeStyle = strokeColor;
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
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - radius);
    ctx.lineTo(x, y - radius - 12);
    ctx.stroke();

    ctx.fillStyle = isWall ? '#ffb347' : '#ff6b6b';
    ctx.beginPath();
    ctx.arc(x, y - radius - 14, 3, 0, Math.PI * 2);
    ctx.fill();

    // Inventory count
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(radius * 0.7)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(inventory), x, y + radius * 0.15);
  }

  private drawPredictionMarker(
    ctx: CanvasRenderingContext2D,
    fromX: number, fromY: number,
    toX: number, toY: number,
  ): void {
    const pulse = 0.5 + Math.sin(this.pulsePhase * 4) * 0.3;

    // Dotted trajectory line
    ctx.strokeStyle = `rgba(255, 120, 80, ${pulse * 0.3})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Landing marker — diamond shape
    const s = 8;
    ctx.fillStyle = `rgba(255, 120, 80, ${pulse * 0.7})`;
    ctx.beginPath();
    ctx.moveTo(toX, toY - s);
    ctx.lineTo(toX + s, toY);
    ctx.lineTo(toX, toY + s);
    ctx.lineTo(toX - s, toY);
    ctx.closePath();
    ctx.fill();

    // Outer ring
    ctx.strokeStyle = `rgba(255, 120, 80, ${pulse * 0.4})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(toX, toY, 14, 0, Math.PI * 2);
    ctx.stroke();
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

    const tdx = dx / len;
    const tdy = dy / len;

    const px = snapshot.player.x;
    const py = snapshot.player.y;
    const isWall = snapshot.player.mode === 'WALL';
    const arrowScale = 3;

    // Use the locked drag mode from drag start
    if (this.dragReservePoint) {
      const rp = this.dragReservePoint;
      // Reserved jump: orange arrow from reserve point
      const arrowLen = 60;
      const angle = Math.atan2(tdy, tdx);

      // Marker on wall (orange pulsing dot)
      const pulse = 0.6 + Math.sin(this.pulsePhase * 3) * 0.3;
      ctx.fillStyle = `rgba(255, 180, 80, ${pulse})`;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(255, 180, 80, ${pulse * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, 13, 0, Math.PI * 2);
      ctx.stroke();

      // Arrow from reserve point
      const ex = rp.x + tdx * arrowLen;
      const ey = rp.y + tdy * arrowLen;

      ctx.strokeStyle = 'rgba(255,180,80,0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(rp.x, rp.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,180,80,0.8)';
      this.drawArrowHead(ctx, ex, ey, angle, 10);

      // Chain prediction: where this drag jump would land
      const dragAngle = Math.atan2(dy, dx);
      let dirQ = Math.round((dragAngle / (2 * Math.PI)) * DIR_STEPS);
      dirQ = ((dirQ % DIR_STEPS) + DIR_STEPS) % DIR_STEPS;
      const dragChainPred = predictJumpLanding(
        rp.x, rp.y, rp.segIdx, dirQ,
        snapshot.player.radius, WALL_JUMP_SPEED,
        FRICTION, FIXED_DT, snapshot.segments, 300,
      );
      if (dragChainPred) {
        this.drawPredictionMarker(ctx, rp.x, rp.y, dragChainPred.wallX, dragChainPred.wallY);
      }
    } else if (isWall) {
      // Immediate wall jump: yellow arrow from player
      const arrowLen = 60;
      const angle = Math.atan2(tdy, tdx);
      const ex = px + tdx * arrowLen;
      const ey = py + tdy * arrowLen;

      ctx.strokeStyle = 'rgba(255,220,100,0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,220,100,0.8)';
      this.drawArrowHead(ctx, ex, ey, angle, 10);
    } else {
      // Space mode: drag direction = movement direction
      const moveVx = (tdx * IMPULSE) / PLAYER_MASS;
      const moveVy = (tdy * IMPULSE) / PLAYER_MASS;

      const cvx = snapshot.player.vx;
      const cvy = snapshot.player.vy;

      // Movement impulse arrow (yellow dashed) — drag direction
      const iex = px + moveVx * arrowScale;
      const iey = py + moveVy * arrowScale;
      const iAngle = Math.atan2(moveVy, moveVx);

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

      // Combined velocity arrow (cyan)
      const combinedVx = cvx + moveVx;
      const combinedVy = cvy + moveVy;
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
