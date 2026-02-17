import type { LevelData, LevelGoalData, Segment } from '../sim/types.ts';
import { PLAYER_RADIUS } from '../sim/constants.ts';

function generateSegments(stage: number, ww: number, wh: number): Segment[] {
  const segments: Segment[] = [];

  if (stage >= 2) {
    // Horizontal bar in upper-middle area
    const bw = ww * 0.35;
    const sx = Math.round((ww - bw) / 2);
    const y = Math.round(wh * 0.32);
    segments.push({ ax: sx, ay: y, bx: sx + Math.round(bw), by: y });
  }

  if (stage >= 4) {
    // Vertical bar on left side
    const bh = wh * 0.25;
    const x = Math.round(ww * 0.25);
    const sy = Math.round(wh * 0.45);
    segments.push({ ax: x, ay: sy, bx: x, by: sy + Math.round(bh) });
  }

  if (stage >= 5) {
    // Vertical bar on right side
    const bh = wh * 0.25;
    const x = Math.round(ww * 0.75);
    const sy = Math.round(wh * 0.2);
    segments.push({ ax: x, ay: sy, bx: x, by: sy + Math.round(bh) });
  }

  if (stage >= 7) {
    // Horizontal bar in lower-middle
    const bw = ww * 0.3;
    const sx = Math.round(ww * 0.1);
    const y = Math.round(wh * 0.6);
    segments.push({ ax: sx, ay: y, bx: sx + Math.round(bw), by: y });
  }

  if (stage >= 8) {
    // Extra horizontal bar upper-right
    const bw = ww * 0.28;
    const sx = Math.round(ww * 0.6);
    const y = Math.round(wh * 0.48);
    segments.push({ ax: sx, ay: y, bx: sx + Math.round(bw), by: y });
  }

  if (stage >= 9) {
    // L-shaped obstacle center (two connected segments)
    const cx = Math.round(ww * 0.45);
    const cy = Math.round(wh * 0.38);
    const sw = Math.round(ww * 0.1);
    const sh = Math.round(wh * 0.08);
    segments.push({ ax: cx, ay: cy, bx: cx + sw, by: cy });         // top horizontal
    segments.push({ ax: cx + sw, ay: cy, bx: cx + sw, by: cy + sh }); // right vertical
  }

  return segments;
}

function generateStage(stage: number): LevelData {
  const goalCount = stage <= 3 ? 1 : stage <= 6 ? 2 : 3;
  const worldWidth = 250 + stage * 10;
  const worldHeight = 350 + stage * 15;
  const inventory = Math.max(3, 10 - stage + goalCount);
  const debrisCount = 3 + Math.floor(stage / 2);
  const baseSpeed = 8 + stage * 1.5;

  const goals: LevelGoalData[] = [];
  for (let i = 0; i < goalCount; i++) {
    const xSlot = (i + 1) / (goalCount + 1);
    goals.push({
      x: Math.round(worldWidth * xSlot),
      y: Math.round(40 + (worldHeight * 0.25) * (i % 2 === 0 ? 0.3 : 0.7)),
      radius: 15 - Math.min(stage, 4),
      vx: Math.round((i % 2 === 0 ? 1 : -1) * baseSpeed),
      vy: Math.round((i % 2 === 0 ? 0.6 : -0.5) * baseSpeed),
    });
  }

  const debris: Array<{ x: number; y: number; radius: number }> = [];
  for (let i = 0; i < debrisCount; i++) {
    const row = Math.floor(i / 3);
    const col = i % 3;
    debris.push({
      x: Math.round(worldWidth * (0.2 + col * 0.3) + (row % 2 === 0 ? 15 : -15)),
      y: Math.round(worldHeight * (0.35 + row * 0.1)),
      radius: i % 2 === 0 ? 8 : 5,
    });
  }

  const segments = generateSegments(stage, worldWidth, worldHeight);

  return {
    id: `stage${String(stage).padStart(2, '0')}`,
    worldWidth,
    worldHeight,
    player: {
      x: Math.round(worldWidth / 2),
      y: worldHeight - PLAYER_RADIUS,
      inventory,
    },
    goals,
    debris,
    segments,
  };
}

export const stages: LevelData[] = Array.from({ length: 10 }, (_, i) => generateStage(i + 1));
