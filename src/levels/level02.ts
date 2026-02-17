import type { LevelData } from '../sim/types.ts';

export const level02: LevelData = {
  id: 'level02',
  worldWidth: 400,
  worldHeight: 550,
  player: {
    x: 200,
    y: 480,
    inventory: 7,
  },
  goals: [
    { x: 80, y: 60, radius: 14, vx: 12, vy: 6 },
    { x: 320, y: 120, radius: 14, vx: -10, vy: 10 },
  ],
  debris: [
    { x: 120, y: 420, radius: 8 },
    { x: 280, y: 400, radius: 5 },
    { x: 60, y: 350, radius: 8 },
    { x: 320, y: 300, radius: 5 },
    { x: 180, y: 280, radius: 8 },
    { x: 100, y: 220, radius: 5 },
    { x: 250, y: 180, radius: 8 },
    { x: 340, y: 160, radius: 5 },
    { x: 150, y: 130, radius: 8 },
    { x: 60, y: 100, radius: 5 },
    { x: 300, y: 80, radius: 8 },
  ],
};
