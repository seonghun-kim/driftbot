import type { LevelData } from '../sim/types.ts';

export const level03: LevelData = {
  id: 'level03',
  worldWidth: 450,
  worldHeight: 600,
  player: {
    x: 225,
    y: 540,
    inventory: 10,
  },
  goals: [
    { x: 100, y: 80, radius: 14, vx: 14, vy: 5 },
    { x: 350, y: 200, radius: 14, vx: -8, vy: 12 },
    { x: 200, y: 50, radius: 14, vx: 10, vy: -8 },
  ],
  debris: [
    { x: 150, y: 480, radius: 8 },
    { x: 300, y: 460, radius: 5 },
    { x: 80, y: 400, radius: 8 },
    { x: 350, y: 380, radius: 5 },
    { x: 200, y: 350, radius: 8 },
    { x: 120, y: 300, radius: 5 },
    { x: 330, y: 270, radius: 8 },
    { x: 60, y: 240, radius: 5 },
    { x: 250, y: 200, radius: 8 },
    { x: 380, y: 160, radius: 5 },
    { x: 150, y: 140, radius: 8 },
    { x: 300, y: 100, radius: 5 },
    { x: 80, y: 80, radius: 8 },
  ],
};
