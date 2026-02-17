import type { ISim } from './ISim.ts';
import type { LevelData, Command, Snapshot, GameState, WallData } from './types.ts';
import {
  FIXED_DT,
  IMPULSE,
  FRICTION,
  PLAYER_RADIUS,
  PLAYER_MASS,
  DEFAULT_DEBRIS_RADIUS,
  DEBRIS_MASS,
  DIR_STEPS,
  PROJECTILE_SPEED,
  PROJECTILE_RADIUS,
  WALL_JUMP_IMPULSE,
  GOAL_ATTRACT_RADIUS,
  GOAL_ATTRACT_STRENGTH,
} from './constants.ts';
import { mulberry32 } from './prng.ts';

interface InternalPlayer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  inventory: number;
  wallStuck: boolean;
  wallNx: number; // outward normal of wall player is stuck to
  wallNy: number;
}

interface InternalDebris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alive: boolean;
}

interface InternalGoal {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  reached: boolean;
}

function dirToVector(dirQ: number): { dx: number; dy: number } {
  const angle = (dirQ / DIR_STEPS) * 2 * Math.PI;
  return { dx: Math.cos(angle), dy: Math.sin(angle) };
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Resolve circle vs axis-aligned rect. Returns true if collided. */
function circleRectCollide(
  cx: number, cy: number, cr: number,
  rx: number, ry: number, rw: number, rh: number,
): { hit: boolean; nx: number; ny: number; overlap: number } {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d >= cr || d < 0.0001) return { hit: false, nx: 0, ny: 0, overlap: 0 };
  return { hit: true, nx: dx / d, ny: dy / d, overlap: cr - d };
}

export class JsSim implements ISim {
  private tick = 0;
  private state: GameState = 'PLAYING';
  private worldWidth = 0;
  private worldHeight = 0;
  private player: InternalPlayer = { x: 0, y: 0, vx: 0, vy: 0, radius: PLAYER_RADIUS, inventory: 0, wallStuck: false, wallNx: 0, wallNy: 0 };
  private goals: InternalGoal[] = [];
  private debris: InternalDebris[] = [];
  private walls: WallData[] = [];
  // Kept for Snapshot compatibility (always empty — thrown items become debris directly)
  private projectiles: Array<{ x: number; y: number; vx: number; vy: number; radius: number; life: number }> = [];

  reset(level: LevelData, seed: number): void {
    const rng = mulberry32(seed);

    this.tick = 0;
    this.state = 'PLAYING';
    this.worldWidth = level.worldWidth;
    this.worldHeight = level.worldHeight;

    this.player = {
      x: level.player.x,
      y: level.player.y,
      vx: 0,
      vy: 0,
      radius: PLAYER_RADIUS,
      inventory: level.player.inventory,
      wallStuck: true,
      wallNx: 0,
      wallNy: -1, // bottom wall normal points up
    };

    this.walls = level.walls ?? [];

    this.goals = level.goals.map((g) => ({
      x: g.x,
      y: g.y,
      vx: g.vx ?? 0,
      vy: g.vy ?? 0,
      radius: g.radius,
      reached: false,
    }));

    this.debris = level.debris.map((d) => ({
      x: d.x + (rng() - 0.5) * 60,
      y: d.y + (rng() - 0.5) * 60,
      vx: d.vx ?? (rng() - 0.5) * 10,
      vy: d.vy ?? (rng() - 0.5) * 10,
      radius: d.radius ?? DEFAULT_DEBRIS_RADIUS,
      alive: true,
    }));

    this.projectiles = [];
  }

  step(ticks: number, commands: Command[]): void {
    for (let t = 0; t < ticks; t++) {
      if (this.state !== 'PLAYING') return;

      // Process commands for this tick
      for (const cmd of commands) {
        if (cmd.type === 'THROW' && cmd.tick === this.tick) {
          this.processThrow(cmd);
        }
      }

      // Update positions
      this.updatePositions();

      // Check collisions
      this.checkCollisions();

      // Check win/lose
      this.checkGameState();

      this.tick++;
    }
  }

  private processThrow(cmd: Command): void {
    const { dx, dy } = dirToVector(cmd.dirQ);

    if (this.player.wallStuck) {
      // Wall jump: launch in drag direction, no debris, no inventory cost
      let vx = dx;
      let vy = dy;

      // If pointing into the wall, project to wall-parallel
      const dot = vx * this.player.wallNx + vy * this.player.wallNy;
      if (dot < 0) {
        vx -= dot * this.player.wallNx;
        vy -= dot * this.player.wallNy;
      }

      const len = Math.sqrt(vx * vx + vy * vy);
      if (len > 0.001) {
        this.player.vx = (vx / len) * WALL_JUMP_IMPULSE / PLAYER_MASS;
        this.player.vy = (vy / len) * WALL_JUMP_IMPULSE / PLAYER_MASS;
      }
      this.player.wallStuck = false;
      return;
    }

    if (this.player.inventory <= 0) return;

    // Player gets impulse in opposite direction (recoil)
    this.player.vx += (-dx * IMPULSE) / PLAYER_MASS;
    this.player.vy += (-dy * IMPULSE) / PLAYER_MASS;

    // Spawn debris in throw direction (item stays in the field)
    this.debris.push({
      x: this.player.x + dx * (this.player.radius + PROJECTILE_RADIUS + 2),
      y: this.player.y + dy * (this.player.radius + PROJECTILE_RADIUS + 2),
      vx: dx * PROJECTILE_SPEED + this.player.vx * 0.3,
      vy: dy * PROJECTILE_SPEED + this.player.vy * 0.3,
      radius: PROJECTILE_RADIUS,
      alive: true,
    });

    this.player.inventory--;
  }

  private updatePositions(): void {
    const p = this.player;
    p.x += p.vx * FIXED_DT;
    p.y += p.vy * FIXED_DT;
    p.vx *= FRICTION;
    p.vy *= FRICTION;

    // Wall stick: player sticks to boundary or internal wall on contact
    let hitWall = false;
    let wnx = 0, wny = 0;
    if (p.x - p.radius < 0) { p.x = p.radius; wnx += 1; hitWall = true; }
    else if (p.x + p.radius > this.worldWidth) { p.x = this.worldWidth - p.radius; wnx -= 1; hitWall = true; }
    if (p.y - p.radius < 0) { p.y = p.radius; wny += 1; hitWall = true; }
    else if (p.y + p.radius > this.worldHeight) { p.y = this.worldHeight - p.radius; wny -= 1; hitWall = true; }
    // Internal walls
    for (const w of this.walls) {
      const c = circleRectCollide(p.x, p.y, p.radius, w.x, w.y, w.w, w.h);
      if (c.hit) {
        p.x += c.nx * c.overlap;
        p.y += c.ny * c.overlap;
        wnx += c.nx;
        wny += c.ny;
        hitWall = true;
      }
    }

    if (hitWall && !p.wallStuck) {
      p.vx = 0;
      p.vy = 0;
      p.wallStuck = true;
      const nlen = Math.sqrt(wnx * wnx + wny * wny);
      if (nlen > 0.001) {
        p.wallNx = wnx / nlen;
        p.wallNy = wny / nlen;
      }
    }

    // Goal attraction: pull player toward nearby unreached goals
    for (const g of this.goals) {
      if (g.reached) continue;
      const dx = g.x - p.x;
      const dy = g.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < GOAL_ATTRACT_RADIUS && d > 0.1) {
        // Strength ramps up as player gets closer (1 at edge, max at center)
        const t = 1 - d / GOAL_ATTRACT_RADIUS; // 0→1
        const accel = GOAL_ATTRACT_STRENGTH * t * t * FIXED_DT;
        p.vx += (dx / d) * accel;
        p.vy += (dy / d) * accel;
      }
    }

    // Update debris
    for (const d of this.debris) {
      if (!d.alive) continue;
      d.x += d.vx * FIXED_DT;
      d.y += d.vy * FIXED_DT;
      d.vx *= FRICTION;
      d.vy *= FRICTION;

      // Bounce debris off boundaries
      if (d.x - d.radius < 0) { d.x = d.radius; d.vx = Math.abs(d.vx) * 0.8; }
      else if (d.x + d.radius > this.worldWidth) { d.x = this.worldWidth - d.radius; d.vx = -Math.abs(d.vx) * 0.8; }
      if (d.y - d.radius < 0) { d.y = d.radius; d.vy = Math.abs(d.vy) * 0.8; }
      else if (d.y + d.radius > this.worldHeight) { d.y = this.worldHeight - d.radius; d.vy = -Math.abs(d.vy) * 0.8; }

      // Bounce debris off internal walls
      for (const w of this.walls) {
        const c = circleRectCollide(d.x, d.y, d.radius, w.x, w.y, w.w, w.h);
        if (c.hit) {
          d.x += c.nx * c.overlap;
          d.y += c.ny * c.overlap;
          const dot = d.vx * c.nx + d.vy * c.ny;
          if (dot < 0) {
            d.vx -= 2 * dot * c.nx * 0.8;
            d.vy -= 2 * dot * c.ny * 0.8;
          }
        }
      }
    }

    // Update goals
    for (const g of this.goals) {
      if (g.reached) continue;
      g.x += g.vx * FIXED_DT;
      g.y += g.vy * FIXED_DT;
      if (g.x - g.radius < 0) { g.x = g.radius; g.vx = Math.abs(g.vx) * 0.8; }
      else if (g.x + g.radius > this.worldWidth) { g.x = this.worldWidth - g.radius; g.vx = -Math.abs(g.vx) * 0.8; }
      if (g.y - g.radius < 0) { g.y = g.radius; g.vy = Math.abs(g.vy) * 0.8; }
      else if (g.y + g.radius > this.worldHeight) { g.y = this.worldHeight - g.radius; g.vy = -Math.abs(g.vy) * 0.8; }

      // Goal vs internal walls
      for (const w of this.walls) {
        const c = circleRectCollide(g.x, g.y, g.radius, w.x, w.y, w.w, w.h);
        if (c.hit) {
          g.x += c.nx * c.overlap;
          g.y += c.ny * c.overlap;
          const dot = g.vx * c.nx + g.vy * c.ny;
          if (dot < 0) {
            g.vx -= 2 * dot * c.nx;
            g.vy -= 2 * dot * c.ny;
          }
        }
      }
    }

    this.projectiles = [];
  }

  private checkCollisions(): void {
    const p = this.player;

    // Player vs debris → bounce + collect
    for (const d of this.debris) {
      if (!d.alive) continue;
      const dx = p.x - d.x;
      const dy = p.y - d.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const minDist = p.radius + d.radius;

      if (distance < minDist && distance > 0.001) {
        // Collision normal (player ← debris)
        const nx = dx / distance;
        const ny = dy / distance;

        // Separate overlapping circles
        const overlap = minDist - distance;
        p.x += nx * overlap * 0.5;
        p.y += ny * overlap * 0.5;
        d.x -= nx * overlap * 0.5;
        d.y -= ny * overlap * 0.5;

        // Relative velocity
        const dvx = p.vx - d.vx;
        const dvy = p.vy - d.vy;
        const dotN = dvx * nx + dvy * ny;

        // Only resolve if objects are approaching
        if (dotN < 0) {
          const restitution = 0.6;
          const invMassSum = 1 / PLAYER_MASS + 1 / DEBRIS_MASS;
          const j = -(1 + restitution) * dotN / invMassSum;
          p.vx += (j / PLAYER_MASS) * nx;
          p.vy += (j / PLAYER_MASS) * ny;
          d.vx -= (j / DEBRIS_MASS) * nx;
          d.vy -= (j / DEBRIS_MASS) * ny;
        }

        // Collect
        d.alive = false;
        p.inventory++;
      }
    }

    // Player vs goals → mark reached, success when all reached
    for (const g of this.goals) {
      if (g.reached) continue;
      const goalDist = dist(p.x, p.y, g.x, g.y);
      if (goalDist < p.radius + g.radius) {
        g.reached = true;
      }
    }
    if (this.goals.length > 0 && this.goals.every((g) => g.reached)) {
      this.state = 'SUCCESS';
    }
  }

  private checkGameState(): void {
    if (this.state !== 'PLAYING') return;

    // Wall-stuck player can always wall jump, so never fail while on wall
    if (this.player.wallStuck) return;

    if (this.player.inventory <= 0 && !this.lookaheadHasCollision()) {
      this.state = 'FAIL';
    }
  }

  /** Simulate 10 seconds ahead (600 ticks) without mutating real state.
   *  Returns true if the player would hit debris or goal. */
  private lookaheadHasCollision(): boolean {
    const LOOKAHEAD_TICKS = 600;

    let px = this.player.x;
    let py = this.player.y;
    let pvx = this.player.vx;
    let pvy = this.player.vy;
    const pr = this.player.radius;

    // Snapshot alive debris positions/velocities
    const debrisCopy = this.debris
      .filter((d) => d.alive)
      .map((d) => ({ x: d.x, y: d.y, vx: d.vx, vy: d.vy, r: d.radius }));

    // Snapshot unreached goals
    const goalsCopy = this.goals
      .filter((g) => !g.reached)
      .map((g) => ({ x: g.x, y: g.y, vx: g.vx, vy: g.vy, r: g.radius }));

    for (let t = 0; t < LOOKAHEAD_TICKS; t++) {
      // Move player
      px += pvx * FIXED_DT;
      py += pvy * FIXED_DT;
      pvx *= FRICTION;
      pvy *= FRICTION;

      // Wall stick in lookahead (boundary + internal)
      let stuck = false;
      if (px - pr < 0) { px = pr; stuck = true; }
      else if (px + pr > this.worldWidth) { px = this.worldWidth - pr; stuck = true; }
      if (py - pr < 0) { py = pr; stuck = true; }
      else if (py + pr > this.worldHeight) { py = this.worldHeight - pr; stuck = true; }
      for (const w of this.walls) {
        const c = circleRectCollide(px, py, pr, w.x, w.y, w.w, w.h);
        if (c.hit) { px += c.nx * c.overlap; py += c.ny * c.overlap; stuck = true; }
      }
      if (stuck) { pvx = 0; pvy = 0; return true; } // can wall jump → not dead

      // Goal attraction in lookahead
      for (const g of goalsCopy) {
        const gdx = g.x - px;
        const gdy = g.y - py;
        const gd = Math.sqrt(gdx * gdx + gdy * gdy);
        if (gd < GOAL_ATTRACT_RADIUS && gd > 0.1) {
          const t = 1 - gd / GOAL_ATTRACT_RADIUS;
          const accel = GOAL_ATTRACT_STRENGTH * t * t * FIXED_DT;
          pvx += (gdx / gd) * accel;
          pvy += (gdy / gd) * accel;
        }
      }

      // Move debris
      for (const d of debrisCopy) {
        d.x += d.vx * FIXED_DT;
        d.y += d.vy * FIXED_DT;
        d.vx *= FRICTION;
        d.vy *= FRICTION;
      }

      // Move goals
      for (const g of goalsCopy) {
        g.x += g.vx * FIXED_DT;
        g.y += g.vy * FIXED_DT;
        if (g.x - g.r < 0) { g.x = g.r; g.vx = Math.abs(g.vx) * 0.8; }
        else if (g.x + g.r > this.worldWidth) { g.x = this.worldWidth - g.r; g.vx = -Math.abs(g.vx) * 0.8; }
        if (g.y - g.r < 0) { g.y = g.r; g.vy = Math.abs(g.vy) * 0.8; }
        else if (g.y + g.r > this.worldHeight) { g.y = this.worldHeight - g.r; g.vy = -Math.abs(g.vy) * 0.8; }
      }

      // Check player vs debris
      for (const d of debrisCopy) {
        if (dist(px, py, d.x, d.y) < pr + d.r) return true;
      }

      // Check player vs goals
      for (const g of goalsCopy) {
        if (dist(px, py, g.x, g.y) < pr + g.r) return true;
      }
    }

    return false;
  }

  getSnapshot(): Snapshot {
    return {
      tick: this.tick,
      state: this.state,
      worldWidth: this.worldWidth,
      worldHeight: this.worldHeight,
      player: { ...this.player },
      goals: this.goals.map((g) => ({
        x: g.x,
        y: g.y,
        vx: g.vx,
        vy: g.vy,
        radius: g.radius,
        reached: g.reached,
      })),
      debris: this.debris.map((d) => ({
        x: d.x,
        y: d.y,
        radius: d.radius,
        alive: d.alive,
      })),
      projectiles: this.projectiles.map((pr) => ({
        x: pr.x,
        y: pr.y,
        vx: pr.vx,
        vy: pr.vy,
        radius: pr.radius,
        life: pr.life,
      })),
      walls: this.walls,
    };
  }
}
