import type { LevelData, LevelGoalData, WallData } from '../sim/types.ts';
import { PLAYER_RADIUS } from '../sim/constants.ts';

function generateWalls(stage: number, ww: number, wh: number): WallData[] {
  const walls: WallData[] = [];
  const thick = 8;

  if (stage >= 2) {
    // Horizontal bar in upper-middle area
    const bw = ww * 0.35;
    walls.push({ x: Math.round((ww - bw) / 2), y: Math.round(wh * 0.32), w: Math.round(bw), h: thick });
  }

  if (stage >= 4) {
    // Vertical bar on left side
    const bh = wh * 0.25;
    walls.push({ x: Math.round(ww * 0.25), y: Math.round(wh * 0.45), w: thick, h: Math.round(bh) });
  }

  if (stage >= 5) {
    // Vertical bar on right side
    const bh = wh * 0.25;
    walls.push({ x: Math.round(ww * 0.75) - thick, y: Math.round(wh * 0.2), w: thick, h: Math.round(bh) });
  }

  if (stage >= 7) {
    // Horizontal bar in lower-middle
    const bw = ww * 0.3;
    walls.push({ x: Math.round(ww * 0.1), y: Math.round(wh * 0.6), w: Math.round(bw), h: thick });
  }

  if (stage >= 8) {
    // Extra horizontal bar upper-right
    const bw = ww * 0.28;
    walls.push({ x: Math.round(ww * 0.6), y: Math.round(wh * 0.48), w: Math.round(bw), h: thick });
  }

  if (stage >= 9) {
    // Small block center
    walls.push({ x: Math.round(ww * 0.45), y: Math.round(wh * 0.38), w: Math.round(ww * 0.1), h: Math.round(wh * 0.08) });
  }

  return walls;
}

function generateStage(stage: number): LevelData {
  // Goals: 1 (stages 1-3), 2 (stages 4-6), 3 (stages 7-10)
  const goalCount = stage <= 3 ? 1 : stage <= 6 ? 2 : 3;

  // Smaller world
  const worldWidth = 250 + stage * 10;
  const worldHeight = 350 + stage * 15;

  // Inventory: starts generous, decreases as stages progress
  const inventory = Math.max(3, 10 - stage + goalCount);

  // Debris: 3 base + 1 per 2 stages
  const debrisCount = 3 + Math.floor(stage / 2);

  // Goal speed ramps up
  const baseSpeed = 8 + stage * 1.5;

  // Generate goal positions spread across upper portion of world
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

  // Generate debris spread across middle area
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

  // Internal walls
  const walls = generateWalls(stage, worldWidth, worldHeight);

  // Player starts stuck at bottom wall
  return {
    id: `stage${String(stage).padStart(2, '0')}`,
    worldWidth,
    worldHeight,
    player: {
      x: Math.round(worldWidth / 2),
      y: worldHeight - PLAYER_RADIUS, // touching bottom wall
      inventory,
    },
    goals,
    debris,
    walls,
  };
}

export const stages: LevelData[] = Array.from({ length: 10 }, (_, i) => generateStage(i + 1));
