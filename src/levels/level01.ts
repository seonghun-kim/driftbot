import type { LevelData } from '../sim/types.ts';

export const level01: LevelData = {
  id: 'level01',
  worldWidth: 335,
  worldHeight: 500,
  player: {
    x: 168,
    y: 416,
    inventory: 5,
  },
  goals: [
    { x: 168, y: 50, radius: 16, vx: 15, vy: 8 },
  ],
  debris: [
    { x: 200, y: 370, radius: 8 },
    { x: 270, y: 310, radius: 5 },
    { x: 230, y: 240, radius: 8 },
    { x: 195, y: 140, radius: 5 },
  ],
};
