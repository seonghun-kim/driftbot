import type { LevelData, Command, Snapshot } from './types.ts';

export interface ISim {
  reset(level: LevelData, seed: number): void;
  step(ticks: number, commands: Command[]): void;
  getSnapshot(): Snapshot;
}
