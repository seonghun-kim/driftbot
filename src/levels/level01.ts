import type { LevelData } from '../sim/types.ts';

export const level01: LevelData = {
  id: 'level01',
  worldWidth: 2000,
  worldHeight: 3000,
  player: {
    x: 1000,
    y: 2500,
    inventory: 5,
  },
  goal: {
    x: 1000,
    y: 300,
    radius: 80,
  },
  debris: [
    { x: 900, y: 2100 },
    { x: 1100, y: 2100 },
    { x: 750, y: 1800 },
    { x: 1250, y: 1800 },
    { x: 1000, y: 1600 },
    { x: 600, y: 1400 },
    { x: 1400, y: 1400 },
    { x: 850, y: 1100 },
    { x: 1150, y: 1100 },
    { x: 1000, y: 900 },
    { x: 700, y: 700 },
    { x: 1300, y: 700 },
    { x: 1000, y: 500 },
  ],
};
