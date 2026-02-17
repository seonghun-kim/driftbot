import type { ISim } from './ISim.ts';
import type { LevelData, Command, Snapshot, GameState, Segment, PlayerMode, SnapshotTarget } from './types.ts';
import {
  FIXED_DT,
  IMPULSE,
  FRICTION,
  PLAYER_RADIUS,
  PLAYER_MASS,
  DEFAULT_DEBRIS_RADIUS,
  DEBRIS_MASS,
  DIR_STEPS,
  WALL_ATTACH_DIST,
  WALL_MOVE_SPEED,
  WALL_JUMP_SPEED,
} from './constants.ts';
import { mulberry32 } from './prng.ts';
import {
  circleSegmentCollide,
  findNearestSegment,
  segmentPoint,
  segmentNormal,
  buildChains,
  findChainForSegment,
  chainArcDist,
  chainAdvance,
  type Chain,
} from './wallGeometry.ts';

interface InternalPlayer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  inventory: number;
  mode: PlayerMode;
  wallSegIdx: number;
  wallT: number;
  wallSide: number; // 1 or -1: multiplied with segmentNormal to get actual outward normal
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

interface InternalTarget {
  type: 'MOVE' | 'JUMP';
  segIdx: number;
  sQ: number;
  t: number;       // resolved parameter on segment
  dirQ?: number;   // jump direction (JUMP only)
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
  private player: InternalPlayer = {
    x: 0, y: 0, vx: 0, vy: 0, radius: PLAYER_RADIUS,
    inventory: 0, mode: 'WALL', wallSegIdx: -1, wallT: 0, wallSide: 1,
  };
  private goals: InternalGoal[] = [];
  private debris: InternalDebris[] = [];
  private segments: Segment[] = [];
  private chains: Chain[] = [];
  private targets: InternalTarget[] = [];

  reset(level: LevelData, seed: number): void {
    const rng = mulberry32(seed);

    this.tick = 0;
    this.state = 'PLAYING';
    this.worldWidth = level.worldWidth;
    this.worldHeight = level.worldHeight;

    // Build segments: world boundary (4 edges) + level segments
    const w = level.worldWidth;
    const h = level.worldHeight;
    this.segments = [
      // Boundary: bottom (left→right), right (bottom→top), top (right→left), left (top→bottom)
      { ax: 0, ay: h, bx: w, by: h },   // 0: bottom
      { ax: w, ay: h, bx: w, by: 0 },   // 1: right
      { ax: w, ay: 0, bx: 0, by: 0 },   // 2: top
      { ax: 0, ay: 0, bx: 0, by: h },   // 3: left
    ];
    if (level.segments) {
      this.segments.push(...level.segments);
    }

    this.chains = buildChains(this.segments);

    // Player starts on bottom boundary segment (index 0)
    const startT = level.player.x / w;
    this.player = {
      x: level.player.x,
      y: h - PLAYER_RADIUS,
      vx: 0,
      vy: 0,
      radius: PLAYER_RADIUS,
      inventory: level.player.inventory,
      mode: 'WALL',
      wallSegIdx: 0,
      wallT: Math.max(0, Math.min(1, startT)),
      wallSide: 1, // Player starts above bottom boundary (positive-normal side)
    };

    this.targets = [];

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
  }

  step(ticks: number, commands: Command[]): void {
    for (let t = 0; t < ticks; t++) {
      if (this.state !== 'PLAYING') return;

      for (const cmd of commands) {
        if (cmd.tick === this.tick) {
          switch (cmd.type) {
            case 'THROW': this.processThrow(cmd); break;
            case 'WALL_TAP': this.processWallTap(cmd); break;
            case 'WALL_RESERVE_JUMP': this.processWallReserveJump(cmd); break;
            case 'WALL_JUMP': this.processWallJump(cmd); break;
          }
        }
      }

      this.updatePositions();
      this.checkCollisions();
      this.checkGameState();
      this.tick++;
    }
  }

  private processThrow(cmd: Command & { type: 'THROW' }): void {
    // Only in SPACE mode
    if (this.player.mode !== 'SPACE') return;
    if (this.player.inventory <= 0) return;

    // dirQ = desired movement direction (drag direction)
    const { dx, dy } = dirToVector(cmd.dirQ);

    // Player moves in drag direction (impulse)
    this.player.vx += (dx * IMPULSE) / PLAYER_MASS;
    this.player.vy += (dy * IMPULSE) / PLAYER_MASS;

    // Debris thrown in opposite direction (reaction)
    const spawnDist = this.player.radius + DEFAULT_DEBRIS_RADIUS + 2;
    this.debris.push({
      x: this.player.x + (-dx) * spawnDist,
      y: this.player.y + (-dy) * spawnDist,
      vx: (-dx) * 90 + this.player.vx * 0.3,
      vy: (-dy) * 90 + this.player.vy * 0.3,
      radius: 5,
      alive: true,
    });

    this.player.inventory--;
  }

  private processWallTap(cmd: Command & { type: 'WALL_TAP' }): void {
    if (this.player.mode !== 'WALL') return;

    // Replace existing targets with this move target
    this.targets = [{
      type: 'MOVE',
      segIdx: cmd.segIdx,
      sQ: cmd.sQ,
      t: cmd.sQ / DIR_STEPS,
    }];
  }

  private processWallReserveJump(cmd: Command & { type: 'WALL_RESERVE_JUMP' }): void {
    // Append to queue (supports chaining multiple jumps)
    this.targets.push({
      type: 'JUMP',
      segIdx: cmd.segIdx,
      sQ: cmd.sQ,
      t: cmd.sQ / DIR_STEPS,
      dirQ: cmd.dirQ,
    });
  }

  private processWallJump(cmd: Command & { type: 'WALL_JUMP' }): void {
    if (this.player.mode !== 'WALL') return;

    const { dx, dy } = dirToVector(cmd.dirQ);

    // Ensure jump goes away from wall (use wallSide-corrected normal)
    if (this.player.wallSegIdx >= 0) {
      const gNorm = segmentNormal(this.segments[this.player.wallSegIdx]);
      const nx = this.player.wallSide * gNorm.nx;
      const ny = this.player.wallSide * gNorm.ny;
      const dot = dx * nx + dy * ny;
      if (dot < 0) {
        // Trying to jump into wall — project to wall-parallel + outward
        const pdx = dx - dot * nx;
        const pdy = dy - dot * ny;
        const plen = Math.sqrt(pdx * pdx + pdy * pdy);
        if (plen > 0.001) {
          this.player.vx = (pdx / plen) * WALL_JUMP_SPEED;
          this.player.vy = (pdy / plen) * WALL_JUMP_SPEED;
        } else {
          // Pure into-wall direction — launch along normal
          this.player.vx = nx * WALL_JUMP_SPEED;
          this.player.vy = ny * WALL_JUMP_SPEED;
        }
      } else {
        this.player.vx = dx * WALL_JUMP_SPEED;
        this.player.vy = dy * WALL_JUMP_SPEED;
      }
    } else {
      this.player.vx = dx * WALL_JUMP_SPEED;
      this.player.vy = dy * WALL_JUMP_SPEED;
    }

    this.player.mode = 'SPACE';
    this.player.wallSegIdx = -1;
    this.targets = [];
  }

  private updatePositions(): void {
    const p = this.player;

    if (p.mode === 'SPACE') {
      this.updateSpaceMode();
    } else {
      this.updateWallMode();
    }

    this.updateDebris();
    this.updateGoals();
  }

  private updateSpaceMode(): void {
    const p = this.player;

    // Inertial movement
    p.x += p.vx * FIXED_DT;
    p.y += p.vy * FIXED_DT;
    p.vx *= FRICTION;
    p.vy *= FRICTION;

    // Check segment collisions for wall attachment
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      const c = circleSegmentCollide(p.x, p.y, p.radius, seg);
      if (c.hit) {
        const beforeX = p.x, beforeY = p.y;
        // Attach to wall — use approach-aware normal (c.nx, c.ny)
        p.vx = 0;
        p.vy = 0;
        p.mode = 'WALL';
        p.wallSegIdx = i;
        p.wallT = c.t;

        // Compute wallSide: which side of the segment the player is on
        const norm = segmentNormal(seg);
        p.wallSide = (c.nx * norm.nx + c.ny * norm.ny) >= 0 ? 1 : -1;

        // Snap using collision normal (always correct regardless of winding)
        const pt = segmentPoint(seg, c.t);
        p.x = pt.x + c.nx * p.radius;
        p.y = pt.y + c.ny * p.radius;
        const jumpDist = Math.sqrt((p.x - beforeX) ** 2 + (p.y - beforeY) ** 2);
        if (jumpDist > 5) {
          console.warn(`[TELEPORT-ATTACH] tick=${this.tick} segIdx=${i} t=${c.t.toFixed(3)} before=(${beforeX.toFixed(1)},${beforeY.toFixed(1)}) after=(${p.x.toFixed(1)},${p.y.toFixed(1)}) dist=${jumpDist.toFixed(1)} normal=(${c.nx.toFixed(3)},${c.ny.toFixed(3)}) seg=(${seg.ax},${seg.ay})→(${seg.bx},${seg.by})`);
        }
        return;
      }
    }

  }

  private updateWallMode(): void {
    const p = this.player;
    if (this.targets.length === 0) {
      // Stay put — keep position snapped to wall
      this.snapPlayerToWall();
      return;
    }

    const target = this.targets[0];

    // Determine direction & distance to target along chain
    const playerChainIdx = findChainForSegment(this.chains, p.wallSegIdx);
    const targetChainIdx = findChainForSegment(this.chains, target.segIdx);

    if (playerChainIdx === -1 || targetChainIdx === -1 || playerChainIdx !== targetChainIdx) {
      // Different chains or not found — remove invalid target
      this.targets.shift();
      return;
    }

    const chain = this.chains[playerChainIdx];
    const arcDist = chainArcDist(
      chain,
      { segIdx: p.wallSegIdx, t: p.wallT },
      { segIdx: target.segIdx, t: target.t },
      this.segments,
    );

    const moveAmount = WALL_MOVE_SPEED * FIXED_DT;

    if (arcDist <= moveAmount) {
      // Reached target — update wallSide if segment changed
      if (target.segIdx !== p.wallSegIdx) {
        this.updateWallSide(target.segIdx);
      }
      p.wallSegIdx = target.segIdx;
      p.wallT = target.t;
      this.snapPlayerToWall();

      if (target.type === 'MOVE') {
        this.targets.shift();
      } else {
        // JUMP target — execute jump
        const { dx, dy } = dirToVector(target.dirQ!);
        const gNorm = segmentNormal(this.segments[target.segIdx]);
        // Use wallSide-corrected normal for direction check
        const nx = p.wallSide * gNorm.nx;
        const ny = p.wallSide * gNorm.ny;
        const dot = dx * nx + dy * ny;

        if (dot < 0) {
          const pdx = dx - dot * nx;
          const pdy = dy - dot * ny;
          const plen = Math.sqrt(pdx * pdx + pdy * pdy);
          if (plen > 0.001) {
            p.vx = (pdx / plen) * WALL_JUMP_SPEED;
            p.vy = (pdy / plen) * WALL_JUMP_SPEED;
          } else {
            p.vx = nx * WALL_JUMP_SPEED;
            p.vy = ny * WALL_JUMP_SPEED;
          }
        } else {
          p.vx = dx * WALL_JUMP_SPEED;
          p.vy = dy * WALL_JUMP_SPEED;
        }

        p.mode = 'SPACE';
        p.wallSegIdx = -1;
        this.targets = [];
      }
    } else {
      // Move toward target
      // Determine sign: which direction along chain is shorter?
      const playerPos = chain.segIndices.indexOf(p.wallSegIdx);
      const targetPos = chain.segIndices.indexOf(target.segIdx);
      let sign = 1;
      if (targetPos < playerPos) {
        sign = -1;
      } else if (targetPos === playerPos) {
        // Same segment: check direction considering flip
        const isFlipped = chain.flipped[playerPos];
        // Forward = toward exit: not flipped → t increases, flipped → t decreases
        if (isFlipped ? (target.t > p.wallT) : (target.t < p.wallT)) {
          sign = -1;
        }
      }

      const prevSegIdx = p.wallSegIdx;
      const prevT = p.wallT;
      const prevX = p.x, prevY = p.y;
      const advanced = chainAdvance(
        chain,
        { segIdx: p.wallSegIdx, t: p.wallT },
        moveAmount * sign,
        this.segments,
      );
      // Update wallSide if segment changed
      if (advanced.segIdx !== prevSegIdx) {
        this.updateWallSide(advanced.segIdx);
      }
      p.wallSegIdx = advanced.segIdx;
      p.wallT = advanced.t;
      this.snapPlayerToWall();
      const moveDist = Math.sqrt((p.x - prevX) ** 2 + (p.y - prevY) ** 2);
      if (moveDist > 5) {
        const prevSeg = this.segments[prevSegIdx];
        const newSeg = this.segments[advanced.segIdx];
        console.warn(`[TELEPORT-MOVE] tick=${this.tick} seg ${prevSegIdx}(t=${prevT.toFixed(3)})→${advanced.segIdx}(t=${advanced.t.toFixed(3)}) pos=(${prevX.toFixed(1)},${prevY.toFixed(1)})→(${p.x.toFixed(1)},${p.y.toFixed(1)}) dist=${moveDist.toFixed(1)} sign=${sign} prevSeg=(${prevSeg.ax},${prevSeg.ay})→(${prevSeg.bx},${prevSeg.by}) newSeg=(${newSeg.ax},${newSeg.ay})→(${newSeg.bx},${newSeg.by})`);
        console.warn(`  chain: indices=[${chain.segIndices}] flipped=[${chain.flipped}] playerPos=${playerPos} targetPos=${targetPos}`);
      }
    }
  }

  /** Update wallSide when transitioning to a new segment.
   *  Projects the current effective normal onto the new segment's geometric normal. */
  private updateWallSide(newSegIdx: number): void {
    const p = this.player;
    if (p.wallSegIdx < 0) return;
    const oldNorm = segmentNormal(this.segments[p.wallSegIdx]);
    const newNorm = segmentNormal(this.segments[newSegIdx]);
    // Current effective normal = wallSide * oldNorm
    const dot = (p.wallSide * oldNorm.nx) * newNorm.nx + (p.wallSide * oldNorm.ny) * newNorm.ny;
    p.wallSide = dot >= 0 ? 1 : -1;
  }

  private snapPlayerToWall(): void {
    const p = this.player;
    if (p.wallSegIdx < 0 || p.wallSegIdx >= this.segments.length) return;
    const seg = this.segments[p.wallSegIdx];
    const pt = segmentPoint(seg, p.wallT);
    const norm = segmentNormal(seg);
    const oldX = p.x, oldY = p.y;
    // Use wallSide to place player on the correct side of the segment
    p.x = pt.x + p.wallSide * norm.nx * p.radius;
    p.y = pt.y + p.wallSide * norm.ny * p.radius;
    const snapDist = Math.sqrt((p.x - oldX) ** 2 + (p.y - oldY) ** 2);
    if (snapDist > 5) {
      console.warn(`[TELEPORT-SNAP] tick=${this.tick} segIdx=${p.wallSegIdx} t=${p.wallT.toFixed(3)} old=(${oldX.toFixed(1)},${oldY.toFixed(1)}) new=(${p.x.toFixed(1)},${p.y.toFixed(1)}) dist=${snapDist.toFixed(1)} pt=(${pt.x.toFixed(1)},${pt.y.toFixed(1)}) norm=(${norm.nx.toFixed(3)},${norm.ny.toFixed(3)}) wallSide=${p.wallSide} seg=(${seg.ax},${seg.ay})→(${seg.bx},${seg.by})`);
    }
  }

  private updateDebris(): void {
    for (const d of this.debris) {
      if (!d.alive) continue;
      d.x += d.vx * FIXED_DT;
      d.y += d.vy * FIXED_DT;
      d.vx *= FRICTION;
      d.vy *= FRICTION;

      // Bounce off segments
      for (const seg of this.segments) {
        const c = circleSegmentCollide(d.x, d.y, d.radius, seg);
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
  }

  private updateGoals(): void {
    for (const g of this.goals) {
      if (g.reached) continue;
      g.x += g.vx * FIXED_DT;
      g.y += g.vy * FIXED_DT;

      // Bounce off segments
      for (const seg of this.segments) {
        const c = circleSegmentCollide(g.x, g.y, g.radius, seg);
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
  }

  private checkCollisions(): void {
    const p = this.player;

    // Player vs debris → collect
    for (const d of this.debris) {
      if (!d.alive) continue;
      const dx = p.x - d.x;
      const dy = p.y - d.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const minDist = p.radius + d.radius;

      if (distance < minDist && distance > 0.001) {
        const nx = dx / distance;
        const ny = dy / distance;
        const overlap = minDist - distance;

        if (p.mode === 'SPACE') {
          // Physics collision
          p.x += nx * overlap * 0.5;
          p.y += ny * overlap * 0.5;
          d.x -= nx * overlap * 0.5;
          d.y -= ny * overlap * 0.5;

          const dvx = p.vx - d.vx;
          const dvy = p.vy - d.vy;
          const dotN = dvx * nx + dvy * ny;

          if (dotN < 0) {
            const restitution = 0.6;
            const invMassSum = 1 / PLAYER_MASS + 1 / DEBRIS_MASS;
            const j = -(1 + restitution) * dotN / invMassSum;
            p.vx += (j / PLAYER_MASS) * nx;
            p.vy += (j / PLAYER_MASS) * ny;
            d.vx -= (j / DEBRIS_MASS) * nx;
            d.vy -= (j / DEBRIS_MASS) * ny;
          }
        }

        d.alive = false;
        p.inventory++;
      }
    }

    // Player vs goals
    for (const g of this.goals) {
      if (g.reached) continue;
      if (dist(p.x, p.y, g.x, g.y) < p.radius + g.radius) {
        g.reached = true;
      }
    }
    if (this.goals.length > 0 && this.goals.every((g) => g.reached)) {
      this.state = 'SUCCESS';
    }
  }

  private checkGameState(): void {
    if (this.state !== 'PLAYING') return;

    // Simplified fail: inventory === 0 while in SPACE mode
    if (this.player.mode === 'SPACE' && this.player.inventory <= 0) {
      // Check if player is moving toward any wall (might attach soon)
      const nearest = findNearestSegment(this.player.x, this.player.y, this.segments);
      if (nearest.dist > WALL_ATTACH_DIST * 3) {
        // Not near any wall and no inventory — check if decelerating to nothing
        const speed = Math.sqrt(this.player.vx ** 2 + this.player.vy ** 2);
        if (speed < 0.5) {
          this.state = 'FAIL';
        }
      }
    }
  }

  getSnapshot(): Snapshot {
    const targetSnapshots: SnapshotTarget[] = this.targets.map((t) => {
      const pt = segmentPoint(this.segments[t.segIdx], t.t);
      return {
        type: t.type,
        segIdx: t.segIdx,
        sQ: t.sQ,
        x: pt.x,
        y: pt.y,
        dirQ: t.dirQ,
      };
    });

    return {
      tick: this.tick,
      state: this.state,
      worldWidth: this.worldWidth,
      worldHeight: this.worldHeight,
      player: {
        x: this.player.x,
        y: this.player.y,
        vx: this.player.vx,
        vy: this.player.vy,
        radius: this.player.radius,
        inventory: this.player.inventory,
        mode: this.player.mode,
        wallSegIdx: this.player.wallSegIdx,
        wallT: this.player.wallT,
      },
      goals: this.goals.map((g) => ({
        x: g.x, y: g.y, vx: g.vx, vy: g.vy,
        radius: g.radius, reached: g.reached,
      })),
      debris: this.debris.map((d) => ({
        x: d.x, y: d.y, radius: d.radius, alive: d.alive,
      })),
      segments: this.segments,
      targets: targetSnapshots,
    };
  }
}
