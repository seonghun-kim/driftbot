import type { ISim } from './ISim.ts';
import type { LevelData, Command, Snapshot, GameState } from './types.ts';
import {
  FIXED_DT,
  IMPULSE,
  FRICTION,
  PLAYER_RADIUS,
  PLAYER_MASS,
  DEFAULT_DEBRIS_RADIUS,
  DIR_STEPS,
  PROJECTILE_SPEED,
  PROJECTILE_RADIUS,
  PROJECTILE_MAX_LIFE,
} from './constants.ts';
import { mulberry32 } from './prng.ts';

interface InternalPlayer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  inventory: number;
}

interface InternalDebris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alive: boolean;
}

interface InternalProjectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
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

export class JsSim implements ISim {
  private tick = 0;
  private state: GameState = 'PLAYING';
  private worldWidth = 0;
  private worldHeight = 0;
  private player: InternalPlayer = { x: 0, y: 0, vx: 0, vy: 0, radius: PLAYER_RADIUS, inventory: 0 };
  private goals: InternalGoal[] = [];
  private debris: InternalDebris[] = [];
  private projectiles: InternalProjectile[] = [];

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
    };

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
    if (this.player.inventory <= 0) return;

    const { dx, dy } = dirToVector(cmd.dirQ);

    // Player gets impulse in opposite direction (recoil)
    this.player.vx += (-dx * IMPULSE) / PLAYER_MASS;
    this.player.vy += (-dy * IMPULSE) / PLAYER_MASS;

    // Spawn projectile in throw direction
    this.projectiles.push({
      x: this.player.x + dx * (this.player.radius + PROJECTILE_RADIUS + 2),
      y: this.player.y + dy * (this.player.radius + PROJECTILE_RADIUS + 2),
      vx: dx * PROJECTILE_SPEED + this.player.vx * 0.3,
      vy: dy * PROJECTILE_SPEED + this.player.vy * 0.3,
      radius: PROJECTILE_RADIUS,
      life: PROJECTILE_MAX_LIFE,
    });

    this.player.inventory--;
  }

  private updatePositions(): void {
    const p = this.player;
    p.x += p.vx * FIXED_DT;
    p.y += p.vy * FIXED_DT;
    p.vx *= FRICTION;
    p.vy *= FRICTION;

    // Bounce off world boundaries
    if (p.x - p.radius < 0) {
      p.x = p.radius;
      p.vx = Math.abs(p.vx) * 0.8;
    } else if (p.x + p.radius > this.worldWidth) {
      p.x = this.worldWidth - p.radius;
      p.vx = -Math.abs(p.vx) * 0.8;
    }
    if (p.y - p.radius < 0) {
      p.y = p.radius;
      p.vy = Math.abs(p.vy) * 0.8;
    } else if (p.y + p.radius > this.worldHeight) {
      p.y = this.worldHeight - p.radius;
      p.vy = -Math.abs(p.vy) * 0.8;
    }

    // Update debris
    for (const d of this.debris) {
      if (!d.alive) continue;
      d.x += d.vx * FIXED_DT;
      d.y += d.vy * FIXED_DT;
      d.vx *= FRICTION;
      d.vy *= FRICTION;

      // Bounce debris off boundaries
      if (d.x - d.radius < 0) { d.x = d.radius; d.vx = Math.abs(d.vx) * 0.6; }
      else if (d.x + d.radius > this.worldWidth) { d.x = this.worldWidth - d.radius; d.vx = -Math.abs(d.vx) * 0.6; }
      if (d.y - d.radius < 0) { d.y = d.radius; d.vy = Math.abs(d.vy) * 0.6; }
      else if (d.y + d.radius > this.worldHeight) { d.y = this.worldHeight - d.radius; d.vy = -Math.abs(d.vy) * 0.6; }
    }

    // Update goals
    for (const g of this.goals) {
      if (g.reached) continue;
      g.x += g.vx * FIXED_DT;
      g.y += g.vy * FIXED_DT;
      if (g.x - g.radius < 0) { g.x = g.radius; g.vx = -g.vx; }
      else if (g.x + g.radius > this.worldWidth) { g.x = this.worldWidth - g.radius; g.vx = -g.vx; }
      if (g.y - g.radius < 0) { g.y = g.radius; g.vy = -g.vy; }
      else if (g.y + g.radius > this.worldHeight) { g.y = this.worldHeight - g.radius; g.vy = -g.vy; }
    }

    // Update projectiles
    for (const pr of this.projectiles) {
      pr.x += pr.vx * FIXED_DT;
      pr.y += pr.vy * FIXED_DT;
      pr.life--;
    }
    // Remove dead projectiles
    this.projectiles = this.projectiles.filter((pr) => pr.life > 0);
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
          const j = -(1 + restitution) * dotN / 2; // equal mass approx
          p.vx += j * nx;
          p.vy += j * ny;
          d.vx -= j * nx;
          d.vy -= j * ny;
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

      // Bounce player off boundaries
      if (px - pr < 0) { px = pr; pvx = Math.abs(pvx) * 0.8; }
      else if (px + pr > this.worldWidth) { px = this.worldWidth - pr; pvx = -Math.abs(pvx) * 0.8; }
      if (py - pr < 0) { py = pr; pvy = Math.abs(pvy) * 0.8; }
      else if (py + pr > this.worldHeight) { py = this.worldHeight - pr; pvy = -Math.abs(pvy) * 0.8; }

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
        if (g.x - g.r < 0 || g.x + g.r > this.worldWidth) g.vx = -g.vx;
        if (g.y - g.r < 0 || g.y + g.r > this.worldHeight) g.vy = -g.vy;
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
    };
  }
}
