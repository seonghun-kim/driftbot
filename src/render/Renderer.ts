import type { Snapshot, Segment, SnapshotTarget, SnapshotGate } from '../sim/types.ts';
import type { InputState, DragClassification } from '../input/InputManager.ts';
import { mulberry32 } from '../sim/prng.ts';
import { IMPULSE, PLAYER_MASS, DIR_STEPS, FRICTION, FIXED_DT, WALL_JUMP_SPEED, DRAG_THRESHOLD } from '../sim/constants.ts';
import { predictWallCollision, predictJumpLanding, computeTrajectory, computeJumpTrajectory } from '../sim/wallGeometry.ts';

const RENDER_SCALE = 0.7;
const MAX_DPR = 1.5;
const CAMERA_LERP = 0.08;
const STAR_COUNT = 60;

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
  private viewSize = 800;
  private prediction: { wallX: number; wallY: number; segIdx: number; t: number } | null = null;
  private allPredictions: { wallX: number; wallY: number; segIdx: number; t: number }[] = [];

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

    // Adaptive viewSize: fewer world units on smaller screens → bigger objects
    // Mobile (~390px min): viewSize ≈ 390 → player ≈ 32 CSS px
    // PC (~1080px min):    viewSize = 800 → player ≈ 43 CSS px
    const minCssDim = Math.min(w, h);
    this.viewSize = Math.min(Math.max(minCssDim, 300), 800);
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

    const scale = Math.min(cw, ch) / this.viewSize;

    // Reverse the camera transform: translate(cw/2, ch/2) → scale → translate(-camX, -camY)
    const worldX = (pixelX - cw / 2) / scale + this.cameraX;
    const worldY = (pixelY - ch / 2) / scale + this.cameraY;

    return { x: worldX, y: worldY };
  }

  draw(
    snapshot: Snapshot,
    inputState?: InputState,
    dc: DragClassification = { type: 'NONE' },
    paused = false,
  ): void {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // Camera: follow player smoothly, but freeze during aim drags
    const isDragging = !!inputState?.dragging && (inputState.dragLength >= DRAG_THRESHOLD);
    const isAimDrag = isDragging && (dc.type === 'RESERVE' || (dc.type === 'PLAYER' && dc.startMode === 'WALL'));
    if (!isAimDrag) {
      const targetCX = snapshot.player.x;
      const targetCY = snapshot.player.y;
      this.cameraX += (targetCX - this.cameraX) * CAMERA_LERP;
      this.cameraY += (targetCY - this.cameraY) * CAMERA_LERP;
    }

    this.scale = Math.min(cw, ch) / this.viewSize;

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

    // Collect gate segment indices for special rendering
    const gateSegSet = new Set<number>();
    if (snapshot.corridor) {
      for (const gate of snapshot.corridor.gates) {
        for (const si of gate.segmentIndices) gateSegSet.add(si);
      }
    }

    // Internal wall segments (index 4+), skip gate segments
    for (let i = 4; i < snapshot.segments.length; i++) {
      if (gateSegSet.has(i)) continue;
      this.drawSegment(ctx, snapshot.segments[i]);
    }

    // Corridor overlays (gates, finish zone) — only when in corridor sub-world
    if (snapshot.corridor && snapshot.corridor.subWorld === 'corridor') {
      for (const gate of snapshot.corridor.gates) {
        this.drawGateBarrier(ctx, gate, snapshot.segments);
      }
      this.drawFinishZone(ctx, snapshot.corridor.finishY, snapshot.corridor.corridorX, snapshot.corridor.corridorW);
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
        FRICTION, FIXED_DT, snapshot.segments,
      );
    } else {
      this.prediction = null;
    }

    // Collect all prediction points (primary + chain from JUMP targets)
    this.allPredictions = [];
    if (this.prediction) {
      this.allPredictions.push(this.prediction);
    }

    // Draw primary trajectory + landing marker
    if (this.prediction) {
      const trajectory = computeTrajectory(
        sp.x, sp.y, sp.vx, sp.vy, sp.radius,
        FRICTION, FIXED_DT, snapshot.segments,
      );
      this.drawTrajectoryPath(ctx, trajectory, 'rgba(255, 120, 80, 0.4)');
      this.drawLandingMarker(ctx, this.prediction.wallX, this.prediction.wallY);
    }

    // Chain predictions: for each JUMP target, show trajectory + landing
    for (const target of snapshot.targets) {
      if (target.type !== 'JUMP' || target.dirQ === undefined) continue;
      const pred = predictJumpLanding(
        target.x, target.y, target.segIdx, target.dirQ,
        sp.radius, WALL_JUMP_SPEED,
        FRICTION, FIXED_DT, snapshot.segments,
      );
      if (pred) {
        this.allPredictions.push(pred);
        const chainTraj = computeJumpTrajectory(
          target.x, target.y, target.segIdx, target.dirQ,
          sp.radius, WALL_JUMP_SPEED,
          FRICTION, FIXED_DT, snapshot.segments,
        );
        this.drawTrajectoryPath(ctx, chainTraj, 'rgba(255, 180, 80, 0.35)');
        this.drawLandingMarker(ctx, pred.wallX, pred.wallY);
      }
    }

    // Drag arrow preview — only for classified drags (Bug 2 fix: NONE → no gizmo)
    if (inputState?.dragging && inputState.dragLength >= DRAG_THRESHOLD && dc.type !== 'NONE') {
      this.drawDragArrow(ctx, snapshot, inputState, dc);
    }

    ctx.restore();

    // Dim overlay when paused
    if (paused) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(0, 0, cw, ch);
    }

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

  /** Draw a curved trajectory path from an array of sample points. */
  private drawTrajectoryPath(
    ctx: CanvasRenderingContext2D,
    points: { x: number; y: number }[],
    color: string,
  ): void {
    if (points.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Draw the landing marker (diamond + ring) at a predicted wall point. */
  private drawLandingMarker(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
  ): void {
    const pulse = 0.75 + Math.sin(this.pulsePhase * 4) * 0.15;

    // Diamond shape
    const s = 8;
    ctx.fillStyle = `rgba(255, 120, 80, ${pulse})`;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s, y);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s, y);
    ctx.closePath();
    ctx.fill();

    // Outer ring
    ctx.strokeStyle = `rgba(255, 120, 80, ${pulse * 0.7})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
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

  private drawGateBarrier(ctx: CanvasRenderingContext2D, gate: SnapshotGate, segments: Segment[]): void {
    if (gate.unlocked) return; // Unlocked gates are offscreen, nothing to draw

    const pulse = 0.5 + Math.sin(this.pulsePhase * 2) * 0.3;

    for (const si of gate.segmentIndices) {
      const seg = segments[si];

      // Outer glow (red/orange)
      ctx.strokeStyle = `rgba(255, 80, 40, ${pulse * 0.5})`;
      ctx.lineWidth = 16;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(seg.ax, seg.ay);
      ctx.lineTo(seg.bx, seg.by);
      ctx.stroke();

      // Core line
      ctx.strokeStyle = `rgba(255, 120, 60, ${0.6 + pulse * 0.3})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(seg.ax, seg.ay);
      ctx.lineTo(seg.bx, seg.by);
      ctx.stroke();

      // Bright center
      ctx.strokeStyle = `rgba(255, 200, 150, ${pulse * 0.6})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(seg.ax, seg.ay);
      ctx.lineTo(seg.bx, seg.by);
      ctx.stroke();
    }

    // Label on gate
    const firstSeg = segments[gate.segmentIndices[0]];
    const midX = (firstSeg.ax + firstSeg.bx) / 2;
    const midY = (firstSeg.ay + firstSeg.by) / 2;

    ctx.fillStyle = `rgba(255, 200, 150, ${0.6 + pulse * 0.3})`;
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = gate.collectedItems >= gate.requiredItems
      ? 'RETURN'
      : `${gate.collectedItems}/${gate.requiredItems}`;
    ctx.fillText(label, midX, midY - 14);
  }

  private drawFinishZone(ctx: CanvasRenderingContext2D, y: number, corridorX: number, corridorW: number): void {
    const pulse = 0.3 + Math.sin(this.pulsePhase * 1.5) * 0.2;

    // Green gradient zone
    const grad = ctx.createLinearGradient(corridorX, y - 30, corridorX, y + 30);
    grad.addColorStop(0, 'rgba(100, 255, 150, 0)');
    grad.addColorStop(0.5, `rgba(100, 255, 150, ${pulse * 0.3})`);
    grad.addColorStop(1, 'rgba(100, 255, 150, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(corridorX, y - 30, corridorW, 60);

    // Dashed line
    ctx.strokeStyle = `rgba(100, 255, 150, ${0.4 + pulse * 0.3})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(corridorX, y);
    ctx.lineTo(corridorX + corridorW, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label
    ctx.fillStyle = `rgba(150, 255, 200, ${0.5 + pulse * 0.3})`;
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FINISH', corridorX + corridorW / 2, y);
  }

  private drawDragArrow(
    ctx: CanvasRenderingContext2D,
    snapshot: Snapshot,
    input: InputState,
    dc: DragClassification,
  ): void {
    if (dc.type === 'NONE') return;

    const dx = input.currentX - input.startX;
    const dy = input.currentY - input.startY;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;

    const tdx = dx / len;
    const tdy = dy / len;

    const px = snapshot.player.x;
    const py = snapshot.player.y;
    const arrowScale = 3;

    if (dc.type === 'RESERVE') {
      // Slingshot: arrow points opposite of drag (reserve point → finger)
      const fingerWorld = this.screenToWorld(input.currentX, input.currentY);
      const rdx = fingerWorld.x - dc.x;
      const rdy = fingerWorld.y - dc.y;
      const rLen = Math.sqrt(rdx * rdx + rdy * rdy);
      if (rLen < 1) return;
      const rndx = -rdx / rLen;
      const rndy = -rdy / rLen;
      const angle = Math.atan2(rndy, rndx);

      // Reserved jump: orange arrow from reserve point
      const arrowLen = 60;

      // Marker on wall (orange pulsing dot)
      const pulse = 0.6 + Math.sin(this.pulsePhase * 3) * 0.3;
      ctx.fillStyle = `rgba(255, 180, 80, ${pulse})`;
      ctx.beginPath();
      ctx.arc(dc.x, dc.y, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(255, 180, 80, ${pulse * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(dc.x, dc.y, 13, 0, Math.PI * 2);
      ctx.stroke();

      // Arrow from reserve point toward finger
      const ex = dc.x + rndx * arrowLen;
      const ey = dc.y + rndy * arrowLen;

      ctx.strokeStyle = 'rgba(255,180,80,0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(dc.x, dc.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,180,80,0.8)';
      this.drawArrowHead(ctx, ex, ey, angle, 10);

      // Chain prediction: where this drag jump would land
      let dirQ = Math.round((angle / (2 * Math.PI)) * DIR_STEPS);
      dirQ = ((dirQ % DIR_STEPS) + DIR_STEPS) % DIR_STEPS;
      const dragChainPred = predictJumpLanding(
        dc.x, dc.y, dc.segIdx, dirQ,
        snapshot.player.radius, WALL_JUMP_SPEED,
        FRICTION, FIXED_DT, snapshot.segments,
      );
      if (dragChainPred) {
        const dragTraj = computeJumpTrajectory(
          dc.x, dc.y, dc.segIdx, dirQ,
          snapshot.player.radius, WALL_JUMP_SPEED,
          FRICTION, FIXED_DT, snapshot.segments,
        );
        this.drawTrajectoryPath(ctx, dragTraj, 'rgba(255, 180, 80, 0.3)');
        this.drawLandingMarker(ctx, dragChainPred.wallX, dragChainPred.wallY);
      }
    } else if (dc.type === 'PLAYER' && dc.startMode === 'WALL') {
      // Slingshot: wall jump arrow points opposite of drag
      const arrowLen = 60;
      const angle = Math.atan2(-tdy, -tdx);
      const ex = px - tdx * arrowLen;
      const ey = py - tdy * arrowLen;

      ctx.strokeStyle = 'rgba(255,220,100,0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,220,100,0.8)';
      this.drawArrowHead(ctx, ex, ey, angle, 10);
    } else if (dc.type === 'PLAYER' && dc.startMode === 'SPACE') {
      // Slingshot: movement is opposite of drag direction
      const moveVx = (-tdx * IMPULSE) / PLAYER_MASS;
      const moveVy = (-tdy * IMPULSE) / PLAYER_MASS;

      const cvx = snapshot.player.vx;
      const cvy = snapshot.player.vy;

      // Movement impulse arrow (yellow dashed) — opposite of drag
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
