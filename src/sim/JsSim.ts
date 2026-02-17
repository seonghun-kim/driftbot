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
  radius: number;
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
  private goal: InternalGoal = { x: 0, y: 0, radius: 0 };
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

    this.goal = {
      x: level.goal.x,
      y: level.goal.y,
      radius: level.goal.radius,
    };

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

    // Player vs debris → collect
    for (const d of this.debris) {
      if (!d.alive) continue;
      const distance = dist(p.x, p.y, d.x, d.y);
      if (distance < p.radius + d.radius) {
        d.alive = false;
        p.inventory++;
      }
    }

    // Player vs goal → success
    const goalDist = dist(p.x, p.y, this.goal.x, this.goal.y);
    if (goalDist < p.radius + this.goal.radius) {
      this.state = 'SUCCESS';
    }
  }

  private checkGameState(): void {
    if (this.state !== 'PLAYING') return;

    // Fail if no inventory and no debris left to collect and speed is very low
    if (this.player.inventory <= 0) {
      const hasAliveDebris = this.debris.some((d) => d.alive);
      const speed = Math.sqrt(this.player.vx ** 2 + this.player.vy ** 2);

      if (!hasAliveDebris && speed < 2) {
        this.state = 'FAIL';
      }
    }
  }

  getSnapshot(): Snapshot {
    return {
      tick: this.tick,
      state: this.state,
      worldWidth: this.worldWidth,
      worldHeight: this.worldHeight,
      player: { ...this.player },
      goal: { ...this.goal },
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
