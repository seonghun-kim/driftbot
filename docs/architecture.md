# Driftbot — 아키텍처 문서

## 시스템 아키텍처 개요

```
┌─────────────────────────────────────────────────────────┐
│                        Browser                          │
│                                                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────┐   │
│  │  Input    │    │  Scene   │    │   UI / HUD       │   │
│  │  Manager  │───▶│  Manager │◀──▶│   (DOM Overlay)  │   │
│  │(src/input)│    │(src/app) │    │   (src/ui)       │   │
│  └──────────┘    └────┬─────┘    └──────────────────┘   │
│                       │                                  │
│              ┌────────┴────────┐                         │
│              ▼                 ▼                         │
│  ┌──────────────────┐  ┌──────────────┐                 │
│  │   Sim (ISim)     │  │   Renderer   │                 │
│  │   (src/sim)      │  │  (src/render)│                 │
│  │                  │  │              │                  │
│  │  ┌────────────┐  │  │  Snapshot    │                 │
│  │  │  JsSim     │  │──▶  → draw()   │                 │
│  │  │ (교체 가능) │  │  │              │                 │
│  │  └────────────┘  │  └──────────────┘                 │
│  └──────────────────┘                                   │
│                                                         │
│  ┌──────────────────┐                                   │
│  │  Levels          │                                   │
│  │  (src/levels)    │                                   │
│  └──────────────────┘                                   │
└─────────────────────────────────────────────────────────┘
```

---

## 데이터 흐름

### 메인 게임 루프 (1프레임)

```
1. Input Event (touch/mouse)
      │
      ▼
2. InputManager.flush() → RawGesture[]
      │  → TAP / SHORT_DRAG / LONG_DRAG
      ▼
2b. GameScene.resolveGestures(gestures, snapshot)
      │  → Command[] (THROW, WALL_TAP, WALL_RESERVE_JUMP, WALL_JUMP)
      ▼
3. Sim.step(1, commands)
      │  → 내부 상태 업데이트 (위치, 속도, 충돌, 상태 판정)
      ▼
4. Sim.getSnapshot()
      │  → Snapshot (읽기 전용 상태 복사본)
      ▼
5. Renderer.draw(snapshot, inputState, dragClassification)
      │  → Canvas 2D 렌더링 (궤적 예측, 드래그 기즈모 포함)
      ▼
6. HUD.update(snapshot)
      │  → DOM 업데이트 (모드, 아이템 수, 디버그 정보)
      ▼
7. GameScene 내부 상태 판정
      │  → SUCCESS/FAIL 시 endDelay 후 ResultScene으로 전환
```

### 고정 Timestep 루프 (GameScene.loop)

```
accumulator = 0
FIXED_DT = 1/60

function loop(timestamp):
  if (!running) return

  if (paused):
    lastTime = timestamp              // 시간 누적 방지
    snap = sim.getSnapshot()
    gestures = inputManager.flush()
    commands = resolveGesturesPaused(gestures, snap, snap.tick)  // RESERVE만 허용
    if (commands.length > 0):
      commandLog.push(...commands)
      sim.step(1, commands)           // 커맨드 적용 위해 1틱 진행
      snap = sim.getSnapshot()
    updateDragLock(snap)
    renderer.draw(snap, inputState, dragClassification, true)
    hud.update(snap)
    requestAnimationFrame(loop)
    return

  delta = timestamp - lastTime
  lastTime = timestamp
  accumulator += delta

  while accumulator >= FIXED_DT:
    gestures = inputManager.flush()
    commands = resolveGestures(gestures, snapshot, tick)
    sim.step(1, commands)
    accumulator -= FIXED_DT

  snapshot = sim.getSnapshot()
  updateDragLock(snapshot)            // 매 프레임 1회 실행 (120Hz에서도 보장)
  renderer.draw(snapshot, inputState, dragClassification)
  hud.update(snapshot)

  // SUCCESS/FAIL 시 endDelay 후 onEnd 콜백
  requestAnimationFrame(loop)
```

---

## 씬 전환 다이어그램

```
   ┌────────────┐
   │ TitleScene  │
   │             │
   │ [Start] ───┼──────┐
   └────────────┘      │
                       ▼
                ┌────────────────┐
                │   GameScene    │
                │                │
                │ ⏸ ←→ PAUSED   │  (pause 토글)
                │                │
                │ SUCCESS ───────┼──┐
                │ FAIL ──────────┼──┤
                └────────────────┘  │
                                    ▼
                       ┌────────────────┐
                       │  ResultScene   │
                       │                │
                       │ [Next Stage] ──┼──▶ GameScene (다음 스테이지)
                       │ [Restart] ─────┼──▶ TitleScene
                       │ [Replay] ──────┼──▶ 리플레이 실행
                       └────────────────┘
```

---

## 모듈 상세

### src/app/

#### main.ts
- 엔트리포인트
- Canvas 생성, 리사이즈 바인딩
- SceneManager, JsSim, Renderer, InputManager, HUD 초기화
- 스테이지 진행 관리 (corridor 스테이지 단독, `?stage=N` URL 파라미터)
- 게임 루프는 GameScene 내부에 임베디드 (별도 loop.ts 없음)

#### scenes/SceneManager.ts
```typescript
interface Scene {
  enter(): void;
  exit(): void;
  update(): void;
  draw(): void;
}

class SceneManager {
  private current: Scene;
  changeScene(next: Scene): void;
}
```

> Note: GameScene은 자체 RAF 루프를 관리하며, `update()`/`draw()`는 no-op.
> TitleScene/ResultScene은 DOM 오버레이 기반으로 동작.

### src/sim/

#### ISim.ts
```typescript
interface ISim {
  reset(level: LevelData, seed: number): void;
  step(ticks: number, commands: Command[]): void;
  getSnapshot(): Snapshot;
}
```

#### JsSim.ts
- `ISim` 구현체
- Space / Wall 듀얼 모드 상태 머신
- 내부 상태를 flat 배열/구조체로 관리
- Corridor 상태 머신: corridorState (게이트 진행, EVA 서브월드 전환)
- step():
  1. 커맨드 처리 (THROW → 반동 적용, WALL_TAP → 벽 이동 타겟 설정, WALL_RESERVE_JUMP → 점프 예약, WALL_JUMP → 벽 점프 실행)
  2. 위치 업데이트 (Space: velocity × dt, Wall: 세그먼트 위 이동)
  3. 세그먼트 기반 벽 충돌 검사 (circleSegmentCollide)
  4. 벽 부착/이탈 판정 (WALL_ATTACH_DIST / WALL_DETACH_DIST)
  5. 타겟 시스템: 이동 타겟 도달 시 정지, 점프 타겟 도달 시 점프 실행
  6. 상태 판정 (SUCCESS / FAIL)
  7. Corridor: 에어락 감지 → enterEva/exitEva, 게이트 해제, finishY 도달
- enterEva(): 복도 상태 저장(SavedCorridorWorld), EVA 월드 로드
- exitEva(): 복도 상태 복원, 플레이어 에어락 위치에 배치
- getSnapshot(): 내부 상태를 Snapshot으로 복사 (corridor 필드 포함)

#### wallGeometry.ts
- 세그먼트 기반 벽 처리를 위한 순수 기하학 함수 모음
- `segmentLength()` — 세그먼트 길이
- `segmentPoint()` — 세그먼트 위 t 위치의 점 좌표
- `segmentNormal()` — 세그먼트의 단위 법선 벡터
- `pointToSegment()` — 점에서 선분까지 최단 거리/투영점 계산
- `circleSegmentCollide()` — 원-선분 충돌 검사 및 반응
- `findNearestSegment()` — 플레이어에서 가장 가까운 벽 세그먼트 탐색
- `buildChains()` — 연결된 세그먼트들을 체인으로 그룹핑
- `findChainForSegment()` — 세그먼트가 속한 체인 인덱스 검색
- `chainArcDist()` — 체인 위 두 지점 간의 호장 거리
- `chainAdvance()` — 체인 위에서 거리 기반 전진 (벽 이동에 사용)
- `predictWallCollision()` — 관성 이동 시뮬레이션으로 착지 예측 (segIdx, t 반환)
- `computeTrajectory()` — 궤적 경로 샘플링 (렌더링용)
- `computeJumpTrajectory()` — 점프 궤적 경로 샘플링
- `predictJumpLanding()` — 점프 후 착지 위치 예측

#### types.ts
- `Command`, `Snapshot`, `LevelData`, `PlayerState` 등 모든 타입 정의
- Corridor 타입: `EvaWorldData`, `GateData`, `CorridorData`, `SnapshotGate`, `SnapshotCorridor`
- Sim ↔ Render 간 공유 인터페이스

### src/render/

#### Renderer.ts
```typescript
class Renderer {
  constructor(canvas: HTMLCanvasElement);
  resize(): void;
  resetCamera(x: number, y: number): void;
  screenToWorld(sx: number, sy: number): { x: number; y: number };
  draw(snapshot: Snapshot, inputState?: InputState, dc?: DragClassification, paused?: boolean): void;
}
```

- 카메라 변환 적용 (`translate`), 에임 드래그 중 카메라 프리즈
- `screenToWorld()` — 화면 좌표 → 월드 좌표 변환 (입력 해석에 사용)
- `drawSegment()` — 세그먼트 기반 벽 렌더링 (3중 레이어: glow + core + bright)
- `drawTarget()` — 이동(녹색)/점프(주황) 타겟 표시
- `drawTrajectoryPath()` — 궤적 예측 경로 (점선)
- `drawLandingMarker()` — 착지 예측 마커 (다이아몬드 + 링, 높은 불투명도)
- `drawDragArrow()` — 드래그 방향 화살표 (RESERVE/PLAYER/SPACE 분기)
- `drawGateBarrier()` — 잠긴 게이트 렌더링 (빨간/주황 글로우 + 아이템 수 라벨)
- `drawFinishZone()` — 결승선 표시 (녹색 그라데이션 + 점선)
- 플레이어 렌더링: Wall 모드(금색) vs Space 모드(시안) 구분
- 카메라 X 잠금: 복도 서브월드에서 수평 스크롤 비활성화
- EVA 전환 시 가로 카메라 슬라이드 (lastSubWorld 기반 전환 감지)
- pause 시 반투명 딤 오버레이

### src/input/

#### InputManager.ts
```typescript
class InputManager {
  constructor(canvas: HTMLCanvasElement);
  setEnabled(v: boolean): void;  // 입력 활성화/비활성화
  flush(): RawGesture[];         // 누적된 제스처 반환 + 내부 비우기
  getInputState(): InputState;   // 현재 드래그 상태 (프리뷰용)
  destroy(): void;               // 이벤트 리스너 정리
}

interface RawGesture {
  type: 'TAP' | 'SHORT_DRAG' | 'LONG_DRAG';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  dirQ: number;  // 양자화된 드래그 방향 (TAP은 0)
}

interface InputState {
  dragging: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  dragLength: number;
}
```

- `pointerdown` / `pointermove` / `pointerup` / `pointercancel` 이벤트 처리
- PointerEvent 사용 (touch + mouse 통합)
- 드래그 끝 시 길이 판정: `< 15px → TAP`, `15~40px → SHORT_DRAG`, `≥ 40px → LONG_DRAG`
- Command 변환은 `GameScene.resolveGestures()`가 담당 (모드별 매핑)

### src/ui/

#### HUD.ts
```typescript
class HUD {
  constructor();  // getElementById로 내부에서 DOM 요소 바인딩
  show(): void;
  hide(): void;
  update(snapshot: Snapshot): void;
  toggleDebug(): void;
  setPauseCallback(cb: () => void): void;
  setPaused(paused: boolean): void;
}
```

- `getElementById`로 `#hud`, `#hud-items`, `#hud-corridor`, `#hud-debug`, `#hud-message`, `#hud-pause` 바인딩
- `pointer-events: none` (Canvas로 입력 통과), pause 버튼만 `pointer-events: auto`
- SPACE / WALL 모드 인디케이터 + 타겟 카운트 표시
- Corridor 모드: `GATE X/3 | COLLECT: Y/Z`, EVA 모드: `[EVA] COLLECT: Y/Z`, 전부 해제: `EXIT ^`
- Snapshot 변경 시만 DOM 업데이트 (diff 체크)
- pause 버튼: ⏸/▶ 아이콘 토글, "PAUSED" 메시지 표시

### src/levels/

#### corridor.ts
- `generateCorridorStage()` — 복도 스테이지 절차적 생성 (900×2000 월드)
- 복도 벽 (에어락 갭 + 바 분할점으로 분리), 게이트 장벽, 직사각형 트래버설 바
- `buildSideWall()` — 벽을 갭/분할점에서 세그먼트 단위로 분리 (체인 연결성 보장)
- 3개 EVA 월드 정의 (EvaWorldData: 크기, 잔해, 플레이어 시작점, returnEdge)
- 복도 내 연료 잔해 배치

#### stages.ts
- `generateStage(1..10)` 함수로 10개 아레나 스테이지 절차적 생성 (현재 미사용, corridor로 대체)

#### level01.ts / level02.ts / level03.ts
- v0.1.0 시절 수동 작성된 레벨 데이터 (현재 미사용)

---

## ISim 교체 지점 (WASM 이행)

```
현재:
  main.ts → new JsSim() as ISim → GameScene에 주입

이행 후:
  main.ts → new WasmSim(wasmModule) as ISim → GameScene에 주입

교체 시 변경 파일:
  - src/app/main.ts (ISim 인스턴스 생성 부분만)
  - src/sim/WasmSim.ts (새로 추가)

변경 불필요:
  - Renderer (Snapshot만 사용)
  - InputManager (RawGesture만 생성)
  - HUD (Snapshot만 읽음)
  - levels/ (LevelData 구조 동일)
```

---

## 파일 트리

```
src/
├── app/
│   ├── main.ts                 # 엔트리포인트 (스테이지 진행 관리)
│   └── scenes/
│       ├── SceneManager.ts     # 씬 전환 관리
│       ├── TitleScene.ts       # 타이틀 씬
│       ├── GameScene.ts        # 게임 플레이 씬 (RAF 루프 내장, pause 지원)
│       └── ResultScene.ts      # 결과 씬 (리플레이 검증)
├── sim/
│   ├── ISim.ts                 # 시뮬레이션 인터페이스
│   ├── JsSim.ts                # JS 물리 구현 (Space/Wall 듀얼 모드)
│   ├── wallGeometry.ts         # 세그먼트 벽 기하학 + 궤적 예측
│   ├── constants.ts            # 튜닝 상수 (IMPULSE, FRICTION 등)
│   ├── types.ts                # 공유 타입
│   └── prng.ts                 # Seed 기반 난수 (mulberry32)
├── render/
│   └── Renderer.ts             # Canvas 2D 렌더러
├── input/
│   └── InputManager.ts         # 터치/마우스 입력
├── ui/
│   └── HUD.ts                  # DOM 오버레이 HUD (pause 버튼 포함)
└── levels/
    ├── corridor.ts             # 복도 스테이지 절차적 생성 (게임에서 사용)
    ├── stages.ts               # (미사용) 10개 아레나 스테이지 절차적 생성
    ├── level01.ts              # (미사용) 수동 작성 레벨
    ├── level02.ts              # (미사용) 수동 작성 레벨
    └── level03.ts              # (미사용) 수동 작성 레벨

index.html                      # 기본 HTML (HUD DOM 구조 포함)
vite.config.ts                  # Vite 설정
tsconfig.json                   # TypeScript 설정
package.json                    # 의존성
```

---

## 상수 & 튜닝 파라미터

```typescript
// src/sim/constants.ts
export const FIXED_DT = 1 / 60;                          // 고정 timestep (초)
export const IMPULSE = 25;                                // 투척 반동 크기
export const FRICTION = 0.99995;                          // 사실상 무감쇠 (우주 공간)
export const PLAYER_RADIUS = 16;                          // 플레이어 반지름
export const PLAYER_MASS = 1.0;                           // 플레이어 질량
export const DEFAULT_DEBRIS_RADIUS = 10;                  // 잔해 기본 반지름
export const DEBRIS_MASS = 0.15;                          // 잔해 질량
export const DIR_STEPS = 1024;                            // 방향 양자화 단계
export const DRAG_THRESHOLD = 40;                         // 드래그 길이 임계값 (px)
export const WALL_ATTACH_DIST = PLAYER_RADIUS + 0.2;     // 벽 부착 판정 거리 (16.2)
export const WALL_MOVE_SPEED = 4;                         // 벽 위 이동 속도 (units/s)
export const WALL_JUMP_SPEED = 56;                        // 벽 점프 속도 (units/s)

// src/render/Renderer.ts (모듈 스코프 상수)
const RENDER_SCALE = 0.7;                                 // 렌더 해상도 배율
const MAX_DPR = 1.5;                                      // 최대 디바이스 픽셀 비율
const CAMERA_LERP = 0.08;                                 // 카메라 보간 속도
const STAR_COUNT = 60;                                    // 배경 별 개수

// src/input/InputManager.ts (모듈 스코프 상수)
const TAP_MAX_DIST = 15;                                  // TAP 판정 최대 거리 (px)
```
