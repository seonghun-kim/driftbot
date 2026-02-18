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

export interface EvaWorldData {
  worldWidth: number;
  worldHeight: number;
  debris: Array<{ x: number; y: number; radius?: number }>;
  playerStart: { x: number; y: number };
  returnEdge: 'left' | 'right';
}

export interface GateData {
  y: number;
  segmentIndices: number[];     // level.segments[] indices (JsSim adds +4 offset)
  requiredItems: number;
  airlock: {
    x: number;
    y: number;
    side: 'left' | 'right';
  };
  evaWorld: EvaWorldData;
}

export interface CorridorData {
  gates: GateData[];
  corridorX: number;
  corridorW: number;
  finishY: number;
  airlockGap: number;           // Y extent of airlock gap below each gate
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
  corridor?: CorridorData;
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

export interface SnapshotGate {
  y: number;
  requiredItems: number;
  collectedItems: number;
  unlocked: boolean;
  airlockSide: 'left' | 'right';
  segmentIndices: number[];
}

export interface SnapshotCorridor {
  currentGate: number;
  gates: SnapshotGate[];
  corridorX: number;
  corridorW: number;
  finishY: number;
  subWorld: 'corridor' | number;
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
  corridor?: SnapshotCorridor;
  events: GameEvent[];
}

export type GameEvent =
  | { type: 'COLLECT'; x: number; y: number }
  | { type: 'WALL_ATTACH'; x: number; y: number }
  | { type: 'WALL_JUMP'; x: number; y: number; dirQ: number }
  | { type: 'THROW'; x: number; y: number; dirQ: number }
  | { type: 'GATE_UNLOCK'; gateIdx: number; y: number; corridorX: number; corridorW: number }
  | { type: 'EVA_ENTER'; side: 'left' | 'right' }
  | { type: 'EVA_EXIT'; side: 'left' | 'right' }
  | { type: 'FINISH' };

export interface ReplayData {
  levelId: string;
  seed: number;
  commands: Command[];
  finalState: GameState;
  finalTick: number;
}
