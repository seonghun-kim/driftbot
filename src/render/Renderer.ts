import type { Snapshot, Segment, SnapshotTarget, SnapshotGate, GameEvent, PlayerMode } from '../sim/types.ts';
import type { InputState, DragClassification } from '../input/InputManager.ts';
import { mulberry32 } from '../sim/prng.ts';
import { IMPULSE, PLAYER_MASS, DIR_STEPS, FRICTION, FIXED_DT, WALL_JUMP_SPEED, DRAG_THRESHOLD } from '../sim/constants.ts';
import { predictWallCollision, predictJumpLanding, computeTrajectory, computeJumpTrajectory } from '../sim/wallGeometry.ts';
import {
  SpriteSheet,
  PLAYER_SPACE_SVG, PLAYER_WALL_SVG,
  DEBRIS_LARGE_SVG, DEBRIS_SMALL_SVG,
  GOAL_SVG, GATE_LOCK_SVG,
  AIRLOCK_RED_SVG, AIRLOCK_GREEN_SVG,
  STAR_FAR_SVG, STAR_NEAR_SVG,
  NEBULA_PURPLE_SVG, NEBULA_BLUE_SVG,
  FINISH_MARKER_SVG,
} from './sprites.ts';

const RENDER_SCALE = 0.7;
const MAX_DPR = 1.5;
const CAMERA_LERP = 0.08;
const STAR_COUNT = 120;
const MAX_PARTICLES = 150;
const MAX_TRAIL_POINTS = 60;

interface Star {
  x: number;
  y: number;
  size: number;
  brightness: number;
  layer: number;        // 0 = far, 1 = near
  sparkleSpeed: number; // randomized sin speed
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number;     // 0~1 (1=born, 0=dead)
  decay: number;    // per-frame decrease
  size: number;
  color: string;    // 'r,g,b' form
}

interface TrailPoint {
  x: number; y: number;
  age: number;       // 0=newest, increases
  mode: PlayerMode;
}

interface ScreenEffect {
  type: 'GATE_FLASH' | 'EVA_VIGNETTE' | 'SUCCESS_FLASH' | 'FAIL_PULSE';
  life: number;    // 0~1
  decay: number;
}

interface NebulaBlob {
  x: number; y: number;
  radius: number;
  color: string; // 'r,g,b'
  alpha: number;
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
  private lastSubWorld: 'corridor' | number | null = null;

  // Effects systems
  private particles: Particle[] = [];
  private trail: TrailPoint[] = [];
  private lastTrailTick = -1;
  private screenEffects: ScreenEffect[] = [];
  private nebulae: NebulaBlob[] = [];
  private prevState: string = 'PLAYING';

  // Sprite system
  private sprites: SpriteSheet;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;

    // Initialize sprite sheet
    this.sprites = new SpriteSheet();
    this.sprites.register('player-space', PLAYER_SPACE_SVG, 64, 64);
    this.sprites.register('player-wall', PLAYER_WALL_SVG, 64, 64);
    this.sprites.register('debris-large', DEBRIS_LARGE_SVG, 32, 32);
    this.sprites.register('debris-small', DEBRIS_SMALL_SVG, 20, 20);
    this.sprites.register('goal', GOAL_SVG, 96, 96);
    this.sprites.register('gate-lock', GATE_LOCK_SVG, 32, 32);
    this.sprites.register('airlock-red', AIRLOCK_RED_SVG, 16, 16);
    this.sprites.register('airlock-green', AIRLOCK_GREEN_SVG, 16, 16);
    this.sprites.register('star-far', STAR_FAR_SVG, 8, 8);
    this.sprites.register('star-near', STAR_NEAR_SVG, 16, 16);
    this.sprites.register('nebula-purple', NEBULA_PURPLE_SVG, 256, 256);
    this.sprites.register('nebula-blue', NEBULA_BLUE_SVG, 256, 256);
    this.sprites.register('finish-marker', FINISH_MARKER_SVG, 48, 48);

    this.generateStars();
    this.resize();
  }

  private generateStars(): void {
    const rng = mulberry32(12345);
    this.stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      const layer = i < STAR_COUNT * 0.6 ? 0 : 1; // 60% far, 40% near
      this.stars.push({
        x: rng() * 5000 - 1500,
        y: rng() * 6000 - 1500,
        size: layer === 0 ? rng() * 1.2 + 0.3 : rng() * 2.5 + 0.8,
        brightness: layer === 0 ? rng() * 0.4 + 0.2 : rng() * 0.6 + 0.4,
        layer,
        sparkleSpeed: rng() * 3 + 1,
      });
    }

    // Generate nebula blobs
    this.nebulae = [
      { x: 400, y: 600, radius: 300, color: '40,20,80', alpha: 0.05 },
      { x: 1200, y: 1500, radius: 400, color: '20,40,80', alpha: 0.04 },
      { x: 800, y: 3000, radius: 350, color: '40,20,80', alpha: 0.04 },
      { x: 200, y: 4500, radius: 250, color: '20,30,70', alpha: 0.05 },
      { x: 1500, y: 5000, radius: 300, color: '30,15,60', alpha: 0.04 },
    ];
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
      // Detect sub-world transitions for horizontal camera slide
      const currentSubWorld = snapshot.corridor?.subWorld ?? null;
      if (this.lastSubWorld !== null && currentSubWorld !== null && this.lastSubWorld !== currentSubWorld) {
        // Sub-world changed — apply horizontal camera offset for slide effect
        if (this.lastSubWorld === 'corridor' && typeof currentSubWorld === 'number') {
          // Entering EVA: offset camera opposite to airlock side so it slides toward EVA
          const gate = snapshot.corridor!.gates[currentSubWorld];
          const slideOffset = gate.airlockSide === 'right' ? -400 : 400;
          this.cameraX += slideOffset;
          // Snap camera Y to player immediately (no vertical jump)
          this.cameraY = snapshot.player.y;
        } else if (typeof this.lastSubWorld === 'number' && currentSubWorld === 'corridor') {
          // Returning to corridor: offset camera from EVA side so it slides back
          const gate = snapshot.corridor!.gates[this.lastSubWorld];
          const slideOffset = gate.airlockSide === 'right' ? 400 : -400;
          this.cameraX += slideOffset;
          // Snap camera Y to player immediately
          this.cameraY = snapshot.player.y;
        }
      }
      this.lastSubWorld = currentSubWorld;

      // Lock camera X to corridor center when in corridor sub-world
      const corridorLockX = snapshot.corridor && snapshot.corridor.subWorld === 'corridor'
        ? snapshot.corridor.corridorX + snapshot.corridor.corridorW / 2
        : null;
      const targetCX = corridorLockX ?? snapshot.player.x;
      const targetCY = snapshot.player.y;
      this.cameraX += (targetCX - this.cameraX) * CAMERA_LERP;
      this.cameraY += (targetCY - this.cameraY) * CAMERA_LERP;
    }

    this.scale = Math.min(cw, ch) / this.viewSize;

    // Process events & update effects
    this.processEvents(snapshot.events);
    this.updateParticles();
    this.updateTrail(snapshot);
    this.updateScreenEffects();

    // Detect state transitions for screen effects
    if (snapshot.state !== this.prevState) {
      if (snapshot.state === 'SUCCESS') {
        this.screenEffects.push({ type: 'SUCCESS_FLASH', life: 1, decay: 1 / 60 });
      } else if (snapshot.state === 'FAIL') {
        this.screenEffects.push({ type: 'FAIL_PULSE', life: 1, decay: 1 / 48 });
      }
      this.prevState = snapshot.state;
    }

    ctx.clearRect(0, 0, cw, ch);

    // Background
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.cameraX, -this.cameraY);

    // Nebula background (deep behind everything)
    this.drawNebula(ctx);

    // Stars (parallax, 2-layer)
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

    // Airlock indicators
    this.drawAirlockIndicators(ctx, snapshot);

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

    // Trail (between debris and player)
    this.drawTrail(ctx);

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

    // Particles (world space)
    this.drawParticles(ctx);

    // Drag arrow preview — only for classified drags (Bug 2 fix: NONE → no gizmo)
    if (inputState?.dragging && inputState.dragLength >= DRAG_THRESHOLD && dc.type !== 'NONE') {
      this.drawDragArrow(ctx, snapshot, inputState, dc);
    }

    ctx.restore();

    // Screen-space effects (after restore, before pause overlay)
    this.drawScreenEffects(ctx, cw, ch);

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
    const spriteFar = this.sprites.get('star-far');
    const spriteNear = this.sprites.get('star-near');

    for (const star of this.stars) {
      const parallax = star.layer === 0 ? 0.1 : 0.3;
      const sx = star.x + this.cameraX * (1 - parallax);
      const sy = star.y + this.cameraY * (1 - parallax);

      const sparkle = 0.7 + Math.sin(this.pulsePhase * star.sparkleSpeed + star.x * 0.01) * 0.3;
      const alpha = star.brightness * sparkle;
      ctx.globalAlpha = alpha;

      if (star.layer === 0) {
        // Far stars: small dot sprite
        const s = star.size * 2.5;
        ctx.drawImage(spriteFar.canvas, sx - s / 2, sy - s / 2, s, s);
      } else {
        // Near stars: cross-shaped sprite
        const s = star.size * 3;
        ctx.drawImage(spriteNear.canvas, sx - s / 2, sy - s / 2, s, s);
      }
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
      const sprite = this.sprites.get('goal');
      const drawSize = g.radius * 3;
      ctx.drawImage(sprite.canvas, g.x - drawSize / 2, g.y - drawSize / 2, drawSize, drawSize);
      ctx.globalAlpha = 1;
      return;
    }

    const pulse = 0.4 + Math.sin(this.pulsePhase * 1.5) * 0.2;

    // Pulsing glow ring (procedural, on top of sprite)
    const grad = ctx.createRadialGradient(g.x, g.y, g.radius * 0.3, g.x, g.y, g.radius * 1.5);
    grad.addColorStop(0, `rgba(100, 255, 150, ${pulse})`);
    grad.addColorStop(1, 'rgba(100, 255, 150, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.radius * 1.5, 0, Math.PI * 2);
    ctx.fill();

    // SVG sprite overlay
    const sprite = this.sprites.get('goal');
    const drawSize = g.radius * 3;
    ctx.globalAlpha = 0.7 + pulse * 0.3;
    ctx.drawImage(sprite.canvas, g.x - drawSize / 2, g.y - drawSize / 2, drawSize, drawSize);
    ctx.globalAlpha = 1;

    // "GOAL" label
    ctx.fillStyle = `rgba(200, 255, 220, ${0.7 + pulse * 0.2})`;
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('GOAL', g.x, g.y);
  }

  private drawDebris(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
    const isLarge = radius >= 7;
    const key = isLarge ? 'debris-large' : 'debris-small';
    const sprite = this.sprites.get(key);
    // Scale sprite to cover 2*radius
    const drawSize = radius * 2.5; // slightly larger than collision radius for visual flair
    ctx.drawImage(sprite.canvas, x - drawSize / 2, y - drawSize / 2, drawSize, drawSize);
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, snapshot: Snapshot): void {
    const { x, y, radius, mode, inventory, vx, vy } = snapshot.player;
    const isWall = mode === 'WALL';
    const key = isWall ? 'player-wall' : 'player-space';
    const sprite = this.sprites.get(key);

    // Sprite covers body + eyes + antenna, so scale to match game radius.
    // SVG viewBox is 64×64; the body circle is r=22 centered at (32,34).
    // We want the body circle to match `radius`, so scale = radius / 22.
    const spriteScale = radius / 22;
    const drawW = sprite.width * spriteScale;
    const drawH = sprite.height * spriteScale;

    ctx.save();
    ctx.translate(x, y);

    // SPACE mode: tilt toward velocity direction
    if (!isWall) {
      const speed = Math.sqrt(vx * vx + vy * vy);
      if (speed > 5) {
        const angle = Math.atan2(vy, vx);
        ctx.rotate(angle + Math.PI / 2);
      }
    }

    // The SVG body center is at (32, 34) in 64×64 space → offset (0, 2) from center.
    // After scaling, the body center offset from top-left is (32*s, 34*s).
    // We want body center at (0,0) in the translated space.
    const ox = -32 * spriteScale;
    const oy = -34 * spriteScale;
    ctx.drawImage(sprite.canvas, ox, oy, drawW, drawH);

    ctx.restore();

    // Inventory count (on top, not rotated)
    if (inventory > 0) {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(radius * 0.7)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(inventory), x, y + radius * 0.15);
    }
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

    // Finish marker sprites at both sides
    const sprite = this.sprites.get('finish-marker');
    const markerSize = 40;
    ctx.drawImage(sprite.canvas, corridorX + 10 - markerSize / 2, y - markerSize / 2, markerSize, markerSize);
    ctx.drawImage(sprite.canvas, corridorX + corridorW - 10 - markerSize / 2, y - markerSize / 2, markerSize, markerSize);

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

  // ========== Effects System ==========

  private processEvents(events: GameEvent[]): void {
    for (const evt of events) {
      switch (evt.type) {
        case 'COLLECT':
          this.spawnParticles(evt.x, evt.y, 14, {
            color: '255,220,80', speedMin: 40, speedMax: 120,
            sizeMin: 3, sizeMax: 7, life: 1.0, spread: Math.PI * 2,
          });
          break;
        case 'WALL_ATTACH':
          this.spawnParticles(evt.x, evt.y, 10, {
            color: '140,190,255', speedMin: 30, speedMax: 70,
            sizeMin: 3, sizeMax: 6, life: 0.7, spread: Math.PI * 2,
          });
          // Clear trail on mode transition
          this.trail = [];
          break;
        case 'WALL_JUMP':
          this.spawnDirectionalParticles(evt.x, evt.y, 12, evt.dirQ, true, {
            color: '255,220,100', speedMin: 50, speedMax: 100,
            sizeMin: 3, sizeMax: 6, life: 0.8,
          });
          // Clear trail on mode transition
          this.trail = [];
          break;
        case 'THROW':
          this.spawnDirectionalParticles(evt.x, evt.y, 10, evt.dirQ, false, {
            color: '255,255,120', speedMin: 60, speedMax: 120,
            sizeMin: 3, sizeMax: 6, life: 0.7,
          });
          break;
        case 'GATE_UNLOCK':
          this.spawnGateParticles(evt.y, evt.corridorX, evt.corridorW, 30);
          this.screenEffects.push({ type: 'GATE_FLASH', life: 1, decay: 1 / 18 });
          break;
        case 'EVA_ENTER':
        case 'EVA_EXIT':
          this.screenEffects.push({ type: 'EVA_VIGNETTE', life: 1, decay: 1 / 30 });
          this.trail = [];
          break;
        case 'FINISH':
          this.spawnFinishParticles(this.cameraX, this.cameraY);
          break;
      }
    }
  }

  private spawnParticles(
    x: number, y: number, count: number,
    cfg: { color: string; speedMin: number; speedMax: number; sizeMin: number; sizeMax: number; life: number; spread: number },
  ): void {
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const angle = Math.random() * cfg.spread - cfg.spread / 2;
      const speed = cfg.speedMin + Math.random() * (cfg.speedMax - cfg.speedMin);
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 1 / (cfg.life * 60),
        size: cfg.sizeMin + Math.random() * (cfg.sizeMax - cfg.sizeMin),
        color: cfg.color,
      });
    }
  }

  private spawnDirectionalParticles(
    x: number, y: number, count: number, dirQ: number,
    invertDir: boolean,
    cfg: { color: string; speedMin: number; speedMax: number; sizeMin: number; sizeMax: number; life: number },
  ): void {
    const baseAngle = (dirQ / DIR_STEPS) * 2 * Math.PI;
    const angle = invertDir ? baseAngle + Math.PI : baseAngle;
    const coneHalf = Math.PI * 0.35;
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const a = angle + (Math.random() - 0.5) * coneHalf * 2;
      const speed = cfg.speedMin + Math.random() * (cfg.speedMax - cfg.speedMin);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 1,
        decay: 1 / (cfg.life * 60),
        size: cfg.sizeMin + Math.random() * (cfg.sizeMax - cfg.sizeMin),
        color: cfg.color,
      });
    }
  }

  private spawnGateParticles(y: number, corridorX: number, corridorW: number, count: number): void {
    const centerX = corridorX + corridorW / 2;
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const px = centerX + (Math.random() - 0.5) * corridorW;
      const speed = 30 + Math.random() * 50;
      const angle = (Math.random() > 0.5 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.5;
      this.particles.push({
        x: px, y,
        vx: Math.cos(angle) * speed,
        vy: (Math.random() - 0.5) * 20,
        life: 1,
        decay: 1 / 60,
        size: 2 + Math.random() * 3,
        color: '255,120,60',
      });
    }
  }

  private spawnFinishParticles(cx: number, cy: number): void {
    for (let i = 0; i < 35 && this.particles.length < MAX_PARTICLES; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
      const speed = 60 + Math.random() * 80;
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 60,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 1 / 90,
        size: 2 + Math.random() * 4,
        color: '100,255,150',
      });
    }
  }

  private updateParticles(): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * FIXED_DT;
      p.y += p.vy * FIXED_DT;
      p.life -= p.decay;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.min(p.life * 1.2, 1);
      ctx.fillStyle = `rgb(${p.color})`;
      const radius = p.size * (0.4 + p.life * 0.6); // shrink less aggressively
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ========== Trail System ==========

  private updateTrail(snapshot: Snapshot): void {
    const tick = snapshot.tick;
    // Add point every 2 ticks
    if (tick !== this.lastTrailTick && tick % 2 === 0) {
      this.lastTrailTick = tick;
      this.trail.push({
        x: snapshot.player.x,
        y: snapshot.player.y,
        age: 0,
        mode: snapshot.player.mode,
      });
      // Cap at max
      while (this.trail.length > MAX_TRAIL_POINTS) {
        this.trail.shift();
      }
    }
    // Age all points
    for (const pt of this.trail) {
      pt.age++;
    }
  }

  private drawTrail(ctx: CanvasRenderingContext2D): void {
    if (this.trail.length < 2) return;

    for (let i = 1; i < this.trail.length; i++) {
      const prev = this.trail[i - 1];
      const curr = this.trail[i];
      const alpha = Math.max(0, (1 - curr.age / MAX_TRAIL_POINTS) * 0.6);
      if (alpha <= 0) continue;

      const color = curr.mode === 'WALL' ? '255,220,100' : '100,200,255';
      ctx.strokeStyle = `rgba(${color},${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(curr.x, curr.y);
      ctx.stroke();
    }

    // Draw dots at trail points
    for (const pt of this.trail) {
      const alpha = Math.max(0, (1 - pt.age / MAX_TRAIL_POINTS) * 0.6);
      if (alpha <= 0) continue;
      const color = pt.mode === 'WALL' ? '255,220,100' : '100,200,255';
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `rgb(${color})`;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ========== Screen Effects ==========

  private updateScreenEffects(): void {
    for (let i = this.screenEffects.length - 1; i >= 0; i--) {
      this.screenEffects[i].life -= this.screenEffects[i].decay;
      if (this.screenEffects[i].life <= 0) {
        this.screenEffects.splice(i, 1);
      }
    }
  }

  private drawScreenEffects(ctx: CanvasRenderingContext2D, cw: number, ch: number): void {
    for (const eff of this.screenEffects) {
      switch (eff.type) {
        case 'GATE_FLASH':
          ctx.fillStyle = `rgba(255, 120, 60, ${eff.life * 0.3})`;
          ctx.fillRect(0, 0, cw, ch);
          break;
        case 'EVA_VIGNETTE': {
          const grad = ctx.createRadialGradient(cw / 2, ch / 2, cw * 0.2, cw / 2, ch / 2, cw * 0.6);
          grad.addColorStop(0, 'rgba(0,0,0,0)');
          grad.addColorStop(1, `rgba(0,0,0,${eff.life * 0.5})`);
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, cw, ch);
          break;
        }
        case 'SUCCESS_FLASH': {
          const grad = ctx.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, cw * 0.6);
          grad.addColorStop(0, 'rgba(100,255,150,0)');
          grad.addColorStop(1, `rgba(100,255,150,${eff.life * 0.35})`);
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, cw, ch);
          break;
        }
        case 'FAIL_PULSE': {
          const grad = ctx.createRadialGradient(cw / 2, ch / 2, cw * 0.2, cw / 2, ch / 2, cw * 0.55);
          grad.addColorStop(0, 'rgba(255,60,60,0)');
          grad.addColorStop(1, `rgba(255,60,60,${eff.life * 0.4})`);
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, cw, ch);
          break;
        }
      }
    }
  }

  // ========== Background Enhancements ==========

  private drawNebula(ctx: CanvasRenderingContext2D): void {
    for (const neb of this.nebulae) {
      const nx = neb.x + this.cameraX * (1 - 0.05);
      const ny = neb.y + this.cameraY * (1 - 0.05);

      // Simple viewport cull
      const dx = nx - this.cameraX;
      const dy = ny - this.cameraY;
      if (Math.abs(dx) > 800 + neb.radius || Math.abs(dy) > 800 + neb.radius) continue;

      // Choose sprite based on color tone
      const isPurple = neb.color.startsWith('40') || neb.color.startsWith('30');
      const sprite = this.sprites.get(isPurple ? 'nebula-purple' : 'nebula-blue');
      const drawSize = neb.radius * 2;
      ctx.globalAlpha = neb.alpha * 3; // boost since SVG gradients are subtle
      ctx.drawImage(sprite.canvas, nx - drawSize / 2, ny - drawSize / 2, drawSize, drawSize);
    }
    ctx.globalAlpha = 1;
  }

  private drawAirlockIndicators(ctx: CanvasRenderingContext2D, snapshot: Snapshot): void {
    if (!snapshot.corridor || snapshot.corridor.subWorld !== 'corridor') return;

    const corridor = snapshot.corridor;
    for (const gate of corridor.gates) {
      if (gate.segmentIndices.length === 0) continue;

      const pulse = 0.5 + Math.sin(this.pulsePhase * 3) * 0.4;
      const spriteKey = gate.unlocked ? 'airlock-green' : 'airlock-red';
      const sprite = this.sprites.get(spriteKey);

      for (const si of gate.segmentIndices) {
        const seg = snapshot.segments[si];
        if (seg.ax < -1e4) continue;

        ctx.globalAlpha = pulse;
        const dotSize = 10;
        ctx.drawImage(sprite.canvas, seg.ax - dotSize / 2, seg.ay - dotSize / 2, dotSize, dotSize);
        ctx.drawImage(sprite.canvas, seg.bx - dotSize / 2, seg.by - dotSize / 2, dotSize, dotSize);
      }
    }
    ctx.globalAlpha = 1;

    // Corridor wall glow points at segment junctions
    for (let i = 4; i < snapshot.segments.length; i++) {
      const seg = snapshot.segments[i];
      if (seg.ax < -1e4) continue;

      ctx.globalAlpha = 0.08;
      ctx.fillStyle = 'rgba(120,170,240,1)';
      ctx.beginPath();
      ctx.arc(seg.ax, seg.ay, 35, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(seg.bx, seg.by, 35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
