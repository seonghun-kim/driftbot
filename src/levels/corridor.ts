import type { LevelData, Segment, CorridorData, EvaWorldData } from '../sim/types.ts';
import { PLAYER_RADIUS } from '../sim/constants.ts';

const AIRLOCK_GAP = 120;

/**
 * Generate the corridor progression stage.
 *
 * Layout: 900x2000 world. Wide corridor x=200~700 (width 500).
 * Camera X is locked — no horizontal scrolling.
 * Traversal bars = thick rectangular ledges protruding from walls.
 */
export function generateCorridorStage(): LevelData {
  const WW = 900;
  const WH = 2000;
  const CX = 200;   // corridor left X
  const CW = 500;   // corridor width
  const CR = CX + CW; // corridor right X (700)

  const segments: Segment[] = [];
  const debris: Array<{ x: number; y: number; radius?: number }> = [];

  // Gate definitions (bottom to top)
  const gateDefs = [
    { y: 1350, required: 1, side: 'right' as const },
    { y: 850,  required: 2, side: 'left' as const },
    { y: 350,  required: 3, side: 'right' as const },
  ];

  // Ledge definitions: thick rectangular bars protruding from walls
  const BAR_W = 120;  // protrusion depth into corridor
  const BAR_H = 25;   // thickness
  const ledges = [
    // Section 1: below gate 1 (Y=1470~1950)
    { y: 1580, side: 'left' as const },
    { y: 1740, side: 'right' as const },
    { y: 1880, side: 'left' as const },
    // Section 2: between gate 1 and gate 2 (Y=970~1300)
    { y: 1060, side: 'right' as const },
    { y: 1200, side: 'left' as const },
    // Section 3: between gate 2 and gate 3 (Y=470~800)
    { y: 560, side: 'right' as const },
    { y: 700, side: 'left' as const },
  ];

  // --- Airlock gaps (below each gate) ---
  const leftGaps: { top: number; bottom: number }[] = [];
  const rightGaps: { top: number; bottom: number }[] = [];
  for (const gd of gateDefs) {
    const gap = { top: gd.y, bottom: gd.y + AIRLOCK_GAP };
    if (gd.side === 'left') leftGaps.push(gap);
    else rightGaps.push(gap);
  }

  // --- Bar split points per wall side ---
  const leftBarSplits: number[] = [];
  const rightBarSplits: number[] = [];
  for (const ledge of ledges) {
    if (ledge.side === 'left') {
      leftBarSplits.push(ledge.y, ledge.y + BAR_H);
    } else {
      rightBarSplits.push(ledge.y, ledge.y + BAR_H);
    }
  }

  // --- Build corridor walls (split at airlock gaps + bar connection points) ---
  buildSideWall(segments, CX, 0, WH, leftGaps, leftBarSplits);
  buildSideWall(segments, CR, 0, WH, rightGaps, rightBarSplits);

  // --- Gate barriers ---
  const gateSegIndicesPerGate: number[][] = [];
  for (const gd of gateDefs) {
    const idx = segments.length;
    segments.push({ ax: CX, ay: gd.y, bx: CR, by: gd.y });
    gateSegIndicesPerGate.push([idx]);
  }

  // --- Ledge segments (3 sides each, connected to wall at split points) ---
  for (const ledge of ledges) {
    if (ledge.side === 'left') {
      // Protrudes from left wall (x=CX) into corridor
      const x1 = CX;
      const x2 = CX + BAR_W;
      segments.push({ ax: x1, ay: ledge.y, bx: x2, by: ledge.y });             // top
      segments.push({ ax: x2, ay: ledge.y, bx: x2, by: ledge.y + BAR_H });     // right end
      segments.push({ ax: x2, ay: ledge.y + BAR_H, bx: x1, by: ledge.y + BAR_H }); // bottom
    } else {
      // Protrudes from right wall (x=CR) into corridor
      const x1 = CR;
      const x2 = CR - BAR_W;
      segments.push({ ax: x1, ay: ledge.y, bx: x2, by: ledge.y });             // top
      segments.push({ ax: x2, ay: ledge.y, bx: x2, by: ledge.y + BAR_H });     // left end
      segments.push({ ax: x2, ay: ledge.y + BAR_H, bx: x1, by: ledge.y + BAR_H }); // bottom
    }
  }

  // --- Corridor debris (fuel pickups) ---
  const corridorDebrisPositions = [
    { x: 450, y: 1750 },
    { x: 400, y: 1150 },
    { x: 500, y: 650 },
  ];
  for (const cd of corridorDebrisPositions) {
    debris.push({ x: cd.x, y: cd.y, radius: 8 });
  }

  // --- EVA world definitions (open space, boundary walls only) ---
  const evaWorlds: EvaWorldData[] = [
    {
      worldWidth: 400,
      worldHeight: 400,
      debris: [{ x: 260, y: 200, radius: 10 }],
      playerStart: { x: 40, y: 200 },
      returnEdge: 'left',
    },
    {
      worldWidth: 400,
      worldHeight: 400,
      debris: [
        { x: 150, y: 140, radius: 10 },
        { x: 150, y: 260, radius: 10 },
      ],
      playerStart: { x: 360, y: 200 },
      returnEdge: 'right',
    },
    {
      worldWidth: 500,
      worldHeight: 500,
      debris: [
        { x: 300, y: 150, radius: 10 },
        { x: 350, y: 300, radius: 10 },
        { x: 200, y: 400, radius: 10 },
      ],
      playerStart: { x: 40, y: 250 },
      returnEdge: 'left',
    },
  ];

  // --- Build corridor data ---
  const corridor: CorridorData = {
    gates: gateDefs.map((gd, i) => ({
      y: gd.y,
      segmentIndices: gateSegIndicesPerGate[i],
      requiredItems: gd.required,
      airlock: {
        x: gd.side === 'right' ? CR : CX,
        y: gd.y + AIRLOCK_GAP / 2,
        side: gd.side,
      },
      evaWorld: evaWorlds[i],
    })),
    corridorX: CX,
    corridorW: CW,
    finishY: 200,
    airlockGap: AIRLOCK_GAP,
  };

  return {
    id: 'corridor01',
    worldWidth: WW,
    worldHeight: WH,
    player: {
      x: CX + CW / 2,
      y: WH - PLAYER_RADIUS,
      inventory: 5,
    },
    goals: [],
    debris,
    segments,
    corridor,
  };
}

/**
 * Build a vertical wall with gaps (airlocks) and splits (bar connection points).
 * Wall segments are broken at each gap and split position so bars can chain with them.
 */
function buildSideWall(
  segments: Segment[],
  x: number,
  wallTop: number,
  wallBottom: number,
  airlockGaps: { top: number; bottom: number }[],
  barSplitYs: number[],
): void {
  // Collect all break points
  const breaks = new Set<number>();
  breaks.add(wallTop);
  breaks.add(wallBottom);

  for (const gap of airlockGaps) {
    breaks.add(gap.top);
    breaks.add(gap.bottom);
  }
  for (const y of barSplitYs) {
    breaks.add(y);
  }

  const sorted = [...breaks].sort((a, b) => a - b);

  function isInGap(y: number): boolean {
    for (const gap of airlockGaps) {
      if (y >= gap.top && y < gap.bottom) return true;
    }
    return false;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const y1 = sorted[i];
    const y2 = sorted[i + 1];
    if (y1 === y2) continue;
    const midY = (y1 + y2) / 2;
    if (!isInGap(midY)) {
      segments.push({ ax: x, ay: y1, bx: x, by: y2 });
    }
  }
}
