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
5. Renderer.draw(snapshot)
      │  → Canvas 2D 렌더링
      ▼
6. HUD.update(snapshot)
      │  → DOM 업데이트 (아이템 수, 디버그 정보)
      ▼
7. SceneManager.check(snapshot)
      │  → SUCCESS/FAIL 시 씬 전환
```

### 고정 Timestep 루프

```
accumulator = 0
FIXED_DT = 1/60

function loop(timestamp):
  delta = timestamp - lastTime
  lastTime = timestamp
  accumulator += delta

  while accumulator >= FIXED_DT:
    commands = inputManager.flush()
    sim.step(1, commands)
    accumulator -= FIXED_DT

  snapshot = sim.getSnapshot()
  alpha = accumulator / FIXED_DT    // 보간용 (선택적)
  renderer.draw(snapshot, alpha)
  hud.update(snapshot)

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
                ┌────────────┐
                │ GameScene  │
                │            │
                │ SUCCESS ───┼──┐
                │ FAIL ──────┼──┤
                └────────────┘  │
                                ▼
                       ┌────────────────┐
                       │  ResultScene   │
                       │                │
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
- SceneManager 초기화
- 게임 루프 시작

#### loop.ts
- `requestAnimationFrame` 기반 루프
- 고정 timestep 로직 (accumulator 패턴)
- 현재 씬의 `update()` + `draw()` 호출

#### scenes/SceneManager.ts
```typescript
interface Scene {
  enter(): void;
  exit(): void;
  update(commands: Command[]): void;
  draw(ctx: CanvasRenderingContext2D): void;
}

class SceneManager {
  private current: Scene;
  changeScene(next: Scene): void;
}
```

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
- step():
  1. 커맨드 처리 (THROW → 반동 적용, WALL_TAP → 벽 이동 타겟 설정, WALL_RESERVE_JUMP → 점프 예약, WALL_JUMP → 벽 점프 실행)
  2. 위치 업데이트 (Space: velocity × dt, Wall: 세그먼트 위 이동)
  3. 세그먼트 기반 벽 충돌 검사 (circleSegmentCollide)
  4. 벽 부착/이탈 판정 (WALL_ATTACH_DIST / WALL_DETACH_DIST)
  5. 타겟 시스템: 이동 타겟 도달 시 정지, 점프 타겟 도달 시 점프 실행
  6. 상태 판정 (SUCCESS / FAIL — 단순화된 실패 조건)
- getSnapshot(): 내부 상태를 Snapshot으로 복사

#### wallGeometry.ts
- 세그먼트 기반 벽 처리를 위한 순수 기하학 함수 모음
- `pointToSegment()` — 점에서 선분까지 최단 거리/투영점 계산
- `circleSegmentCollide()` — 원-선분 충돌 검사 및 반응
- `findNearestSegment()` — 플레이어에서 가장 가까운 벽 세그먼트 탐색
- `buildChains()` — 연결된 세그먼트들을 체인으로 그룹핑
- `chainAdvance()` — 체인 위에서 거리 기반 전진 (벽 이동에 사용)

#### types.ts
- `Command`, `Snapshot`, `LevelData`, `PlayerState` 등 모든 타입 정의
- Sim ↔ Render 간 공유 인터페이스

### src/render/

#### Renderer.ts
```typescript
class Renderer {
  constructor(canvas: HTMLCanvasElement);
  draw(snapshot: Snapshot, inputState?: InputState): void;
  screenToWorld(sx: number, sy: number): { x: number; y: number };
}
```

- 카메라 변환 적용 (`translate`)
- `screenToWorld()` — 화면 좌표 → 월드 좌표 변환 (입력 해석에 사용)
- `drawSegment()` — 세그먼트 기반 벽 렌더링 (`drawWall()` 대체)
- `drawTarget()` — 이동/점프 타겟 표시
- 플레이어 렌더링: Wall 모드(금색) vs Space 모드(시안) 구분
- 입력 상태(드래그 중)면 화살표 프리뷰 그리기

### src/input/

#### InputManager.ts
```typescript
class InputManager {
  constructor(canvas: HTMLCanvasElement);
  flush(): RawGesture[];        // 누적된 제스처 반환 + 내부 비우기
  getInputState(): InputState;  // 현재 드래그 상태 (프리뷰용)
}

type RawGesture =
  | { type: 'TAP'; x: number; y: number }
  | { type: 'SHORT_DRAG'; x: number; y: number; dx: number; dy: number }
  | { type: 'LONG_DRAG'; x: number; y: number; dx: number; dy: number };

interface InputState {
  dragging: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}
```

- `pointerdown` / `pointermove` / `pointerup` 이벤트 처리
- PointerEvent 사용 (touch + mouse 통합)
- 드래그 끝 시 길이 판정 → `RawGesture` 생성 (TAP, SHORT_DRAG, LONG_DRAG)
- Command 변환은 `GameScene.resolveGestures()`가 담당 (모드별 매핑)

### src/ui/

#### HUD.ts
```typescript
class HUD {
  constructor(container: HTMLElement);
  update(snapshot: Snapshot): void;
  showMessage(text: string): void;
  toggleDebug(): void;
}
```

- DOM 요소 생성/업데이트
- `pointer-events: none` (Canvas로 입력 통과)
- SPACE / WALL 모드 인디케이터 표시
- 타겟 카운트 표시
- Snapshot 변경 시만 DOM 업데이트 (diff 체크)

### src/levels/

#### level01.ts
```typescript
export const level01: LevelData = {
  id: 'level01',
  worldWidth: 2000,
  worldHeight: 3000,
  player: { x: 1000, y: 2500, inventory: 3 },
  goal: { x: 1000, y: 300, radius: 80 },
  debris: [
    { x: 800, y: 2000, radius: 20 },
    { x: 1200, y: 1700, radius: 25 },
    // ... 10~15개
  ],
};
```

#### prng.ts
- Seed 기반 의사 난수 생성기 (mulberry32)
- 레벨 배치 변동에 사용
- 리플레이 재현성 보장

---

## ISim 교체 지점 (WASM 이행)

```
현재:
  SceneManager → new JsSim() as ISim

이행 후:
  SceneManager → new WasmSim(wasmModule) as ISim

교체 시 변경 파일:
  - src/app/scenes/GameScene.ts (ISim 인스턴스 생성 부분만)
  - src/sim/WasmSim.ts (새로 추가)

변경 불필요:
  - Renderer (Snapshot만 사용)
  - InputManager (RawGesture만 생성)
  - HUD (Snapshot만 읽음)
  - levels/ (LevelData 구조 동일)
```

---

## 파일 트리 (예상)

```
src/
├── app/
│   ├── main.ts                 # 엔트리포인트
│   ├── loop.ts                 # RAF 루프 + 고정 timestep
│   └── scenes/
│       ├── SceneManager.ts     # 씬 전환 관리
│       ├── TitleScene.ts       # 타이틀 씬
│       ├── GameScene.ts        # 게임 플레이 씬
│       └── ResultScene.ts      # 결과 씬
├── sim/
│   ├── ISim.ts                 # 시뮬레이션 인터페이스
│   ├── JsSim.ts                # JS 물리 구현 (Space/Wall 듀얼 모드)
│   ├── wallGeometry.ts         # 세그먼트 벽 기하학 함수
│   ├── types.ts                # 공유 타입
│   └── prng.ts                 # Seed 기반 난수
├── render/
│   └── Renderer.ts             # Canvas 2D 렌더러
├── input/
│   └── InputManager.ts         # 터치/마우스 입력
├── ui/
│   └── HUD.ts                  # DOM 오버레이 HUD
└── levels/
    ├── stages.ts               # 스테이지 목록 및 순서 관리
    ├── level01.ts              # 스테이지 1 데이터
    ├── level02.ts              # 스테이지 2 데이터
    └── level03.ts              # 스테이지 3 데이터

index.html                      # 기본 HTML
vite.config.ts                  # Vite 설정
tsconfig.json                   # TypeScript 설정
package.json                    # 의존성
```

---

## 상수 & 튜닝 파라미터

```typescript
// src/sim/constants.ts

export const FIXED_DT = 1 / 60;          // 고정 timestep (초)
export const IMPULSE = 200;              // 투척 반동 크기
export const FRICTION = 0.999;           // 미세 감쇠 (1.0 = 감쇠 없음)
export const PLAYER_RADIUS = 25;         // 플레이어 반지름
export const PLAYER_MASS = 1.0;          // 플레이어 질량
export const ITEM_MASS = 0.5;            // 아이템 질량
export const DIR_STEPS = 1024;           // 방향 양자화 단계
export const WALL_ATTACH_DIST = ...;     // 벽 부착 판정 거리
export const WALL_DETACH_DIST = ...;     // 벽 이탈 판정 거리
export const WALL_MOVE_SPEED = ...;      // 벽 위 이동 속도
export const WALL_JUMP_SPEED = ...;      // 벽 점프 속도

// src/input/constants.ts
export const DRAG_THRESHOLD = 40;        // 드래그 길이 임계값 (px)

// src/render/constants.ts
export const RENDER_SCALE = 0.7;         // 렌더 해상도 배율
export const MAX_DPR = 1.5;             // 최대 디바이스 픽셀 비율
export const CAMERA_LERP = 0.08;         // 카메라 보간 속도
export const STAR_COUNT = 40;            // 배경 별 개수
```
