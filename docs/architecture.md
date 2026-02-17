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
2. InputManager.getCommand()
      │  → Command | null
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
- 내부 상태를 flat 배열/구조체로 관리
- step():
  1. 커맨드 처리 (THROW → 반동 적용)
  2. 위치 업데이트 (velocity × dt)
  3. 충돌 검사 (player ↔ debris, player ↔ goal)
  4. 상태 판정 (SUCCESS / FAIL)
- getSnapshot(): 내부 상태를 Snapshot으로 복사

#### types.ts
- `Command`, `Snapshot`, `LevelData`, `PlayerState` 등 모든 타입 정의
- Sim ↔ Render 간 공유 인터페이스

### src/render/

#### Renderer.ts
```typescript
class Renderer {
  constructor(canvas: HTMLCanvasElement);
  draw(snapshot: Snapshot, inputState?: InputState): void;
}
```

- 카메라 변환 적용 (`translate`)
- 오브젝트별 draw 함수 분리
- 입력 상태(드래그 중)면 화살표 프리뷰 그리기

### src/input/

#### InputManager.ts
```typescript
class InputManager {
  constructor(canvas: HTMLCanvasElement);
  flush(): Command[];           // 누적된 커맨드 반환 + 내부 비우기
  getInputState(): InputState;  // 현재 드래그 상태 (프리뷰용)
}

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
- 드래그 끝 시 길이 판정 → Command 생성 또는 아이템 선택

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
  - InputManager (Command만 생성)
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
│   ├── JsSim.ts                # JS 물리 구현
│   ├── types.ts                # 공유 타입
│   └── prng.ts                 # Seed 기반 난수
├── render/
│   └── Renderer.ts             # Canvas 2D 렌더러
├── input/
│   └── InputManager.ts         # 터치/마우스 입력
├── ui/
│   └── HUD.ts                  # DOM 오버레이 HUD
└── levels/
    └── level01.ts              # 스테이지 1 데이터

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

// src/input/constants.ts
export const DRAG_THRESHOLD = 40;        // 드래그 길이 임계값 (px)

// src/render/constants.ts
export const RENDER_SCALE = 0.7;         // 렌더 해상도 배율
export const MAX_DPR = 1.5;             // 최대 디바이스 픽셀 비율
export const CAMERA_LERP = 0.08;         // 카메라 보간 속도
export const STAR_COUNT = 40;            // 배경 별 개수
```
