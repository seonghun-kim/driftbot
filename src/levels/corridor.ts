import type { LevelData, Segment, CorridorData, EvaWorldData } from '../sim/types.ts';
import { PLAYER_RADIUS } from '../sim/constants.ts';

const AIRLOCK_GAP = 120;

/**
 * Generate the corridor progression stage.
 *
 * Layout: 900x2000 world. Central corridor x=300~600.
 * 3 gates at Y=1350, 850, 350. Airlock gaps are BELOW each gate.
 * EVA = separate sub-world (open space, no internal walls).
 */
export function generateCorridorStage(): LevelData {
  const WW = 900;
  const WH = 2000;
  const CX = 300;   // corridor left X
  const CW = 300;   // corridor width
  const CR = CX + CW; // corridor right X (600)

  const segments: Segment[] = [];
  const debris: Array<{ x: number; y: number; radius?: number }> = [];

  // Gate definitions (bottom to top)
  const gateDefs = [
    { y: 1350, required: 1, side: 'right' as const },
    { y: 850,  required: 2, side: 'left' as const },
    { y: 350,  required: 3, side: 'right' as const },
  ];

  // --- Build corridor walls with airlock gaps BELOW each gate ---
  // Airlock gap extends from gate.y to gate.y + AIRLOCK_GAP (downward toward player start)

  const leftGaps: { top: number; bottom: number }[] = [];
  const rightGaps: { top: number; bottom: number }[] = [];

  for (const gd of gateDefs) {
    const gap = { top: gd.y, bottom: gd.y + AIRLOCK_GAP };
    if (gd.side === 'left') {
      leftGaps.push(gap);
    } else {
      rightGaps.push(gap);
    }
  }

  function buildSideWall(x: number, gaps: { top: number; bottom: number }[]) {
    const sorted = [...gaps].sort((a, b) => a.top - b.top);
    let currentY = 0;
    for (const gap of sorted) {
      if (currentY < gap.top) {
        segments.push({ ax: x, ay: currentY, bx: x, by: gap.top });
      }
      currentY = gap.bottom;
    }
    if (currentY < WH) {
      segments.push({ ax: x, ay: currentY, bx: x, by: WH });
    }
  }

  buildSideWall(CX, leftGaps);
  buildSideWall(CR, rightGaps);

  // --- Gate barriers (horizontal segments across corridor) ---
  const gateSegIndicesPerGate: number[][] = [];

  for (const gd of gateDefs) {
    const idx = segments.length;
    segments.push({ ax: CX, ay: gd.y, bx: CR, by: gd.y });
    gateSegIndicesPerGate.push([idx]);
  }

  // --- Traversal bars (zigzag platforms inside corridor) ---
  // Section 1: below gate 1 (Y=1470 to Y=1950)
  addTraversalBars(segments, CX, CW, 1500, 1920, 4);
  // Section 2: between gate 1 and gate 2 (Y=970 to Y=1300)
  addTraversalBars(segments, CX, CW, 980, 1300, 3);
  // Section 3: between gate 2 and gate 3 (Y=470 to Y=800)
  addTraversalBars(segments, CX, CW, 490, 800, 3);

  // --- Corridor debris (fuel pickups) ---
  const corridorDebrisPositions = [
    { x: 450, y: 1750 },
    { x: 400, y: 1150 },
    { x: 500, y: 650 },
  ];
  for (const cd of corridorDebrisPositions) {
    debris.push({ x: cd.x, y: cd.y, radius: 8 });
  }

  // --- EVA world definitions (separate sub-worlds, open space) ---
  const evaWorlds: EvaWorldData[] = [
    // Gate 1 (right side, 1 item)
    {
      worldWidth: 400,
      worldHeight: 400,
      debris: [{ x: 260, y: 200, radius: 10 }],
      playerStart: { x: 40, y: 200 },
      returnEdge: 'left',
    },
    // Gate 2 (left side, 2 items)
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
    // Gate 3 (right side, 3 items)
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
      x: 450,
      y: WH - PLAYER_RADIUS,
      inventory: 5,
    },
    goals: [],
    debris,
    segments,
    corridor,
  };
}

/** Add zigzag horizontal traversal bars inside the corridor. */
function addTraversalBars(
  segments: Segment[],
  corridorX: number,
  corridorW: number,
  yTop: number,
  yBottom: number,
  count: number,
): void {
  const barW = corridorW * 0.6;
  const spacing = (yBottom - yTop) / (count + 1);

  for (let i = 0; i < count; i++) {
    const y = Math.round(yTop + spacing * (i + 1));
    const isLeft = i % 2 === 0;
    const sx = isLeft
      ? corridorX + corridorW * 0.05
      : corridorX + corridorW - barW - corridorW * 0.05;
    segments.push({
      ax: Math.round(sx),
      ay: y,
      bx: Math.round(sx + barW),
      by: y,
    });
  }
}
