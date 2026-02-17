export interface LevelGoalData {
  x: number;
  y: number;
  radius: number;
  vx?: number;
  vy?: number;
}

export interface WallData {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LevelData {
  id: string;
  worldWidth: number;
  worldHeight: number;
  player: {
    x: number;
    y: number;
    inventory: number;
  };
  goals: LevelGoalData[];
  debris: Array<{
    x: number;
    y: number;
    vx?: number;
    vy?: number;
    radius?: number;
  }>;
  walls?: WallData[];
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
  wallStuck: boolean;
  wallNx: number;
  wallNy: number;
}

export interface SnapshotGoal {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  reached: boolean;
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
  goals: SnapshotGoal[];
  debris: SnapshotDebris[];
  projectiles: SnapshotProjectile[];
  walls: WallData[];
}

export interface ReplayData {
  levelId: string;
  seed: number;
  commands: Command[];
  finalState: GameState;
  finalTick: number;
}
