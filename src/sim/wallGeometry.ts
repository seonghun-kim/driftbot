import type { Segment } from './types.ts';
import { DIR_STEPS } from './constants.ts';

const EPSILON = 0.001;

// --- Primitive geometry ---

export function segmentLength(seg: Segment): number {
  const dx = seg.bx - seg.ax;
  const dy = seg.by - seg.ay;
  return Math.sqrt(dx * dx + dy * dy);
}

export function segmentPoint(seg: Segment, t: number): { x: number; y: number } {
  return {
    x: seg.ax + (seg.bx - seg.ax) * t,
    y: seg.ay + (seg.by - seg.ay) * t,
  };
}

/** Outward normal of segment (perpendicular, rotated 90deg CW from A→B direction). */
export function segmentNormal(seg: Segment): { nx: number; ny: number } {
  const dx = seg.bx - seg.ax;
  const dy = seg.by - seg.ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < EPSILON) return { nx: 0, ny: -1 };
  return { nx: dy / len, ny: -dx / len };
}

/** Closest point on segment to a given point. Returns position, parameter t, and distance. */
export function pointToSegment(
  px: number, py: number, seg: Segment,
): { x: number; y: number; t: number; dist: number } {
  const dx = seg.bx - seg.ax;
  const dy = seg.by - seg.ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < EPSILON * EPSILON) {
    // Degenerate segment (point)
    const d = Math.sqrt((px - seg.ax) ** 2 + (py - seg.ay) ** 2);
    return { x: seg.ax, y: seg.ay, t: 0, dist: d };
  }
  let t = ((px - seg.ax) * dx + (py - seg.ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = seg.ax + dx * t;
  const cy = seg.ay + dy * t;
  const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
  return { x: cx, y: cy, t, dist };
}

/** Circle vs segment collision. */
export function circleSegmentCollide(
  cx: number, cy: number, cr: number, seg: Segment,
): { hit: boolean; nx: number; ny: number; overlap: number; t: number } {
  const p = pointToSegment(cx, cy, seg);
  if (p.dist >= cr) {
    return { hit: false, nx: 0, ny: 0, overlap: 0, t: p.t };
  }
  if (p.dist < EPSILON) {
    // Already coincident with surface — use segment normal as fallback
    const sn = segmentNormal(seg);
    return { hit: true, nx: sn.nx, ny: sn.ny, overlap: cr, t: p.t };
  }
  const nx = (cx - p.x) / p.dist;
  const ny = (cy - p.y) / p.dist;
  return { hit: true, nx, ny, overlap: cr - p.dist, t: p.t };
}

/** Find the nearest segment to a point. */
export function findNearestSegment(
  px: number, py: number, segments: Segment[],
): { segIdx: number; t: number; dist: number } {
  let bestIdx = -1;
  let bestT = 0;
  let bestDist = Infinity;
  for (let i = 0; i < segments.length; i++) {
    const p = pointToSegment(px, py, segments[i]);
    if (p.dist < bestDist) {
      bestDist = p.dist;
      bestIdx = i;
      bestT = p.t;
    }
  }
  return { segIdx: bestIdx, t: bestT, dist: bestDist };
}

// --- Wall chains ---

/**
 * A chain is a maximal sequence of connected segments in geometric traversal order.
 * flipped[i] = true means segment segIndices[i] is traversed B→A
 * (t=1 is entry, t=0 is exit in the forward direction).
 */
export interface Chain {
  segIndices: number[];
  flipped: boolean[];
  totalLength: number;
}

/** Check if two points are within epsilon distance. */
function pointsClose(ax: number, ay: number, bx: number, by: number, eps: number): boolean {
  return Math.abs(ax - bx) < eps && Math.abs(ay - by) < eps;
}

/**
 * Build chains from segments. Two segments are connected if they share an endpoint.
 * Returns geometrically ordered chains with per-segment orientation (flipped).
 */
export function buildChains(segments: Segment[]): Chain[] {
  const n = segments.length;
  if (n === 0) return [];

  const EPS = 0.5;

  // adjA[i] = neighbours connected to segment i's A-endpoint
  // adjB[i] = neighbours connected to segment i's B-endpoint
  type EndRef = { segIdx: number; end: 'a' | 'b' };
  const adjA: EndRef[][] = Array.from({ length: n }, () => []);
  const adjB: EndRef[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const si = segments[i], sj = segments[j];
      if (pointsClose(si.bx, si.by, sj.ax, sj.ay, EPS)) {
        adjB[i].push({ segIdx: j, end: 'a' });
        adjA[j].push({ segIdx: i, end: 'b' });
      }
      if (pointsClose(si.bx, si.by, sj.bx, sj.by, EPS)) {
        adjB[i].push({ segIdx: j, end: 'b' });
        adjB[j].push({ segIdx: i, end: 'b' });
      }
      if (pointsClose(si.ax, si.ay, sj.ax, sj.ay, EPS)) {
        adjA[i].push({ segIdx: j, end: 'a' });
        adjA[j].push({ segIdx: i, end: 'a' });
      }
      if (pointsClose(si.ax, si.ay, sj.bx, sj.by, EPS)) {
        adjA[i].push({ segIdx: j, end: 'b' });
        adjB[j].push({ segIdx: i, end: 'a' });
      }
    }
  }

  const visited = new Set<number>();
  const chains: Chain[] = [];

  for (let start = 0; start < n; start++) {
    if (visited.has(start)) continue;

    // BFS to find connected component
    const component = new Set<number>();
    const bfsStack = [start];
    while (bfsStack.length > 0) {
      const idx = bfsStack.pop()!;
      if (component.has(idx)) continue;
      component.add(idx);
      for (const e of adjA[idx]) if (!component.has(e.segIdx)) bfsStack.push(e.segIdx);
      for (const e of adjB[idx]) if (!component.has(e.segIdx)) bfsStack.push(e.segIdx);
    }

    // Find a free-end segment (endpoint with no neighbour) to start the walk
    let chainStart = start;
    let startFlipped = false;
    for (const idx of component) {
      if (adjA[idx].length === 0) {
        chainStart = idx;
        startFlipped = false; // traverse A→B (A is free end = chain start)
        break;
      }
      if (adjB[idx].length === 0) {
        chainStart = idx;
        startFlipped = true; // traverse B→A (B is free end = chain start)
        break;
      }
    }
    // If no free end → it's a loop; use start, not flipped

    // Walk the chain in geometric order
    const segIndices: number[] = [];
    const flipped: boolean[] = [];
    let curIdx = chainStart;
    let curFlipped = startFlipped;

    while (!visited.has(curIdx)) {
      visited.add(curIdx);
      segIndices.push(curIdx);
      flipped.push(curFlipped);

      // Exit end: not flipped → B-end, flipped → A-end
      const exitAdj = curFlipped ? adjA[curIdx] : adjB[curIdx];
      const next = exitAdj.find(e => !visited.has(e.segIdx));
      if (!next) break;

      // next.end = which end of the next segment is connected to our exit
      // 'a' → enter at A, traverse A→B (not flipped)
      // 'b' → enter at B, traverse B→A (flipped)
      curFlipped = next.end === 'b';
      curIdx = next.segIdx;
    }

    let totalLength = 0;
    for (const idx of segIndices) totalLength += segmentLength(segments[idx]);
    chains.push({ segIndices, flipped, totalLength });
  }

  return chains;
}

/** Find which chain a segment belongs to. */
export function findChainForSegment(chains: Chain[], segIdx: number): number {
  for (let i = 0; i < chains.length; i++) {
    if (chains[i].segIndices.includes(segIdx)) return i;
  }
  return -1;
}

/**
 * Arc-length distance between two positions on the same chain.
 * Respects per-segment flipped orientation.
 */
export function chainArcDist(
  chain: Chain,
  from: { segIdx: number; t: number },
  to: { segIdx: number; t: number },
  segments: Segment[],
): number {
  if (from.segIdx === to.segIdx) {
    return Math.abs(to.t - from.t) * segmentLength(segments[from.segIdx]);
  }

  const indices = chain.segIndices;
  const fromPos = indices.indexOf(from.segIdx);
  const toPos = indices.indexOf(to.segIdx);
  if (fromPos === -1 || toPos === -1) return Infinity;

  let dist = 0;

  if (fromPos <= toPos) {
    // Forward: distance from current t to exit end of starting segment
    const fromExit = chain.flipped[fromPos] ? 0 : 1;
    dist += Math.abs(from.t - fromExit) * segmentLength(segments[indices[fromPos]]);
    for (let i = fromPos + 1; i < toPos; i++) {
      dist += segmentLength(segments[indices[i]]);
    }
    const toEntry = chain.flipped[toPos] ? 1 : 0;
    dist += Math.abs(to.t - toEntry) * segmentLength(segments[indices[toPos]]);
  } else {
    // Backward
    const fromEntry = chain.flipped[fromPos] ? 1 : 0;
    dist += Math.abs(from.t - fromEntry) * segmentLength(segments[indices[fromPos]]);
    for (let i = fromPos - 1; i > toPos; i--) {
      dist += segmentLength(segments[indices[i]]);
    }
    const toExit = chain.flipped[toPos] ? 0 : 1;
    dist += Math.abs(to.t - toExit) * segmentLength(segments[indices[toPos]]);
  }

  return dist;
}

/**
 * Move along a chain by a given distance.
 * Positive = forward along chain, negative = backward.
 * Respects per-segment flipped orientation.
 */
export function chainAdvance(
  chain: Chain,
  current: { segIdx: number; t: number },
  distance: number,
  segments: Segment[],
): { segIdx: number; t: number } {
  const indices = chain.segIndices;
  let pos = indices.indexOf(current.segIdx);
  if (pos === -1) return { ...current };

  let remaining = distance;
  let t = current.t;

  if (remaining >= 0) {
    // Move forward along chain
    while (remaining > EPSILON) {
      const len = segmentLength(segments[indices[pos]]);
      const flip = chain.flipped[pos];
      // Forward exit end: not flipped → t=1, flipped → t=0
      const tExit = flip ? 0 : 1;
      const availableInSeg = Math.abs(t - tExit) * len;

      if (remaining <= availableInSeg) {
        t += (flip ? -1 : 1) * remaining / len;
        remaining = 0;
      } else {
        remaining -= availableInSeg;
        if (pos + 1 < indices.length) {
          pos++;
          // Entry t for next segment
          t = chain.flipped[pos] ? 1 : 0;
        } else {
          t = tExit;
          remaining = 0;
        }
      }
    }
  } else {
    // Move backward along chain
    remaining = -remaining;
    while (remaining > EPSILON) {
      const len = segmentLength(segments[indices[pos]]);
      const flip = chain.flipped[pos];
      // Backward entry end: not flipped → t=0, flipped → t=1
      const tEntry = flip ? 1 : 0;
      const availableInSeg = Math.abs(t - tEntry) * len;

      if (remaining <= availableInSeg) {
        t -= (flip ? -1 : 1) * remaining / len;
        remaining = 0;
      } else {
        remaining -= availableInSeg;
        if (pos - 1 >= 0) {
          pos--;
          // Exit t of previous segment (we're going backward through it)
          t = chain.flipped[pos] ? 0 : 1;
        } else {
          t = tEntry;
          remaining = 0;
        }
      }
    }
  }

  return { segIdx: indices[pos], t };
}

/**
 * Predict where a moving circle will first collide with a wall segment.
 * Simulates forward with friction, returns wall contact info or null.
 */
export function predictWallCollision(
  px: number, py: number,
  vx: number, vy: number,
  radius: number,
  friction: number,
  dt: number,
  segments: Segment[],
  maxTicks: number = 1000,
): { wallX: number; wallY: number; segIdx: number; t: number } | null {
  let x = px, y = py;
  let cvx = vx, cvy = vy;

  for (let i = 0; i < maxTicks; i++) {
    x += cvx * dt;
    y += cvy * dt;
    cvx *= friction;
    cvy *= friction;

    for (let s = 0; s < segments.length; s++) {
      const c = circleSegmentCollide(x, y, radius, segments[s]);
      if (c.hit) {
        const pt = segmentPoint(segments[s], c.t);
        return { wallX: pt.x, wallY: pt.y, segIdx: s, t: c.t };
      }
    }

    if (cvx * cvx + cvy * cvy < 0.25) break;
  }

  return null;
}

/**
 * Compute the trajectory path of a moving circle until wall collision.
 * Returns sampled points along the path. Used for rendering trajectory curves.
 */
export function computeTrajectory(
  px: number, py: number,
  vx: number, vy: number,
  radius: number,
  friction: number,
  dt: number,
  segments: Segment[],
  maxTicks: number = 1000,
  sampleStep: number = 3,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  let x = px, y = py;
  let cvx = vx, cvy = vy;

  for (let i = 0; i < maxTicks; i++) {
    x += cvx * dt;
    y += cvy * dt;
    cvx *= friction;
    cvy *= friction;

    if (i % sampleStep === 0) points.push({ x, y });

    for (let s = 0; s < segments.length; s++) {
      const c = circleSegmentCollide(x, y, radius, segments[s]);
      if (c.hit) {
        points.push({ x, y });
        return points;
      }
    }

    if (cvx * cvx + cvy * cvy < 0.25) break;
  }

  return points;
}

/**
 * Compute the trajectory path from a wall jump.
 */
export function computeJumpTrajectory(
  wallX: number, wallY: number, segIdx: number, dirQ: number,
  playerRadius: number, jumpSpeed: number,
  friction: number, dt: number,
  segments: Segment[],
  maxTicks: number = 1000,
  sampleStep: number = 3,
): { x: number; y: number }[] {
  const angle = (dirQ / DIR_STEPS) * 2 * Math.PI;
  const jdx = Math.cos(angle);
  const jdy = Math.sin(angle);
  const norm = segmentNormal(segments[segIdx]);
  const dot = jdx * norm.nx + jdy * norm.ny;

  let jvx: number, jvy: number;
  if (dot < 0) {
    const pdx = jdx - dot * norm.nx;
    const pdy = jdy - dot * norm.ny;
    const plen = Math.sqrt(pdx * pdx + pdy * pdy);
    if (plen > 0.001) {
      jvx = (pdx / plen) * jumpSpeed;
      jvy = (pdy / plen) * jumpSpeed;
    } else {
      jvx = norm.nx * jumpSpeed;
      jvy = norm.ny * jumpSpeed;
    }
  } else {
    jvx = jdx * jumpSpeed;
    jvy = jdy * jumpSpeed;
  }

  const startX = wallX + norm.nx * playerRadius;
  const startY = wallY + norm.ny * playerRadius;

  return computeTrajectory(startX, startY, jvx, jvy, playerRadius, friction, dt, segments, maxTicks, sampleStep);
}

/**
 * Predict where a player will land after a wall jump.
 * Computes jump velocity (with wall-normal correction) and simulates the trajectory.
 */
export function predictJumpLanding(
  wallX: number, wallY: number, segIdx: number, dirQ: number,
  playerRadius: number, jumpSpeed: number,
  friction: number, dt: number,
  segments: Segment[],
  maxTicks: number = 1000,
): { wallX: number; wallY: number; segIdx: number; t: number } | null {
  const angle = (dirQ / DIR_STEPS) * 2 * Math.PI;
  const jdx = Math.cos(angle);
  const jdy = Math.sin(angle);
  const norm = segmentNormal(segments[segIdx]);
  const dot = jdx * norm.nx + jdy * norm.ny;

  let jvx: number, jvy: number;
  if (dot < 0) {
    const pdx = jdx - dot * norm.nx;
    const pdy = jdy - dot * norm.ny;
    const plen = Math.sqrt(pdx * pdx + pdy * pdy);
    if (plen > 0.001) {
      jvx = (pdx / plen) * jumpSpeed;
      jvy = (pdy / plen) * jumpSpeed;
    } else {
      jvx = norm.nx * jumpSpeed;
      jvy = norm.ny * jumpSpeed;
    }
  } else {
    jvx = jdx * jumpSpeed;
    jvy = jdy * jumpSpeed;
  }

  const startX = wallX + norm.nx * playerRadius;
  const startY = wallY + norm.ny * playerRadius;

  return predictWallCollision(startX, startY, jvx, jvy, playerRadius, friction, dt, segments, maxTicks);
}
