export const FIXED_DT = 1 / 60;
export const IMPULSE = 25;
export const FRICTION = 0.9992;
export const PLAYER_RADIUS = 16;
export const PLAYER_MASS = 1.0;
export const DEFAULT_DEBRIS_RADIUS = 10;
export const DEBRIS_MASS = 0.15;
export const DIR_STEPS = 1024;
// v0.2 Wall system
export const WALL_ATTACH_DIST = PLAYER_RADIUS + 0.2;
export const WALL_DETACH_DIST = WALL_ATTACH_DIST + 0.1;
export const WALL_MOVE_SPEED = 4;     // units/s (along wall)
export const WALL_JUMP_SPEED = 56;    // units/s (immediate jump from wall)
