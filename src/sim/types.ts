export interface LevelData {
  id: string;
  worldWidth: number;
  worldHeight: number;
  player: {
    x: number;
    y: number;
    inventory: number;
  };
  goal: {
    x: number;
    y: number;
    radius: number;
  };
  debris: Array<{
    x: number;
    y: number;
    vx?: number;
    vy?: number;
    radius?: number;
  }>;
}

export type Command = {
  type: 'THROW';
  tick: number;
  dirQ: number; // 0~1023
};

export type GameState = 'PLAYING' | 'SUCCESS' | 'FAIL';

export interface SnapshotPlayer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  inventory: number;
}

export interface SnapshotGoal {
  x: number;
  y: number;
  radius: number;
}

export interface SnapshotDebris {
  x: number;
  y: number;
  radius: number;
  alive: boolean;
}

export interface SnapshotProjectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
}

export interface Snapshot {
  tick: number;
  state: GameState;
  worldWidth: number;
  worldHeight: number;
  player: SnapshotPlayer;
  goal: SnapshotGoal;
  debris: SnapshotDebris[];
  projectiles: SnapshotProjectile[];
}

export interface ReplayData {
  levelId: string;
  seed: number;
  commands: Command[];
  finalState: GameState;
  finalTick: number;
}
