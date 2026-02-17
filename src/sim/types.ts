// --- v0.2 Segment-based wall system ---

export interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface LevelGoalData {
  x: number;
  y: number;
  radius: number;
  vx?: number;
  vy?: number;
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
  segments?: Segment[];
}

export type Command =
  | { type: 'THROW'; tick: number; dirQ: number }
  | { type: 'WALL_TAP'; tick: number; segIdx: number; sQ: number }
  | { type: 'WALL_RESERVE_JUMP'; tick: number; segIdx: number; sQ: number; dirQ: number }
  | { type: 'WALL_JUMP'; tick: number; dirQ: number };

export type GameState = 'PLAYING' | 'SUCCESS' | 'FAIL';

export type PlayerMode = 'SPACE' | 'WALL';

export interface SnapshotPlayer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  inventory: number;
  mode: PlayerMode;
  wallSegIdx: number;  // -1 if space
  wallT: number;       // 0~1 parameter on current segment
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

export interface SnapshotTarget {
  type: 'MOVE' | 'JUMP';
  segIdx: number;
  sQ: number;
  x: number;
  y: number;
  dirQ?: number;  // jump direction (JUMP only)
}

export interface Snapshot {
  tick: number;
  state: GameState;
  worldWidth: number;
  worldHeight: number;
  player: SnapshotPlayer;
  goals: SnapshotGoal[];
  debris: SnapshotDebris[];
  segments: Segment[];
  targets: SnapshotTarget[];
}

export interface ReplayData {
  levelId: string;
  seed: number;
  commands: Command[];
  finalState: GameState;
  finalTick: number;
}
