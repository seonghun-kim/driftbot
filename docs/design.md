# Driftbot — 상세 설계 문서

## 1. 게임 컨셉

### 핵심 메카닉
- 우주 공간(마찰 ≈ 0)에서 **물건을 던져 생기는 반동**으로만 이동
- 플레이어(로봇)는 초기 아이템을 가지고 출발
- 떠다니는 잔해를 접촉으로 획득 → 인벤토리에 추가
- 방향만 결정, 투척 힘은 고정

### 승리/실패 조건
| 조건 | 판정 |
|------|------|
| 승리 | 플레이어 원 ∩ 목표 원 (겹침 즉시) |
| 실패 | 인벤토리 아이템 = 0 (단순화) |

---

## 2. 씬 구성

### 2.1 TitleScene
- 게임 타이틀 표시
- "Start" 버튼 (DOM 또는 Canvas)
- 탭/클릭 시 GameScene 전환

### 2.2 GameScene
- 1개 스테이지 플레이
- HUD 오버레이 (DOM)
- 입력 처리 → Command 생성 → Sim.step()
- 매 프레임 Snapshot → Render

### 2.3 ResultScene
- Success / Fail 표시
- "Restart" 버튼 → TitleScene 또는 GameScene 재시작
- "Replay" 버튼 → 커맨드 로그 재생으로 결과 검증

---

## 3. 월드 오브젝트

### 3.1 플레이어 (Player)
```typescript
interface PlayerState {
  x: number;          // 위치 X
  y: number;          // 위치 Y
  vx: number;         // 속도 X
  vy: number;         // 속도 Y
  radius: number;     // 충돌/렌더 반지름
  inventory: number;  // 보유 아이템 수
}
```

### 3.2 목표 (Goal)
```typescript
interface GoalState {
  x: number;
  y: number;
  radius: number;
}
```

### 3.3 잔해/아이템 (Debris)
```typescript
interface DebrisState {
  x: number;
  y: number;
  vx: number;         // 잔해도 떠다닐 수 있음
  vy: number;
  radius: number;
  alive: boolean;     // 획득되면 false
}
```

### 3.4 성능 예산
- 화면 내 오브젝트: 20개 전후 (플레이어 1 + 목표 1 + 잔해 10~20)
- 충돌 검사: 브루트포스 O(n²) 허용 (n ≤ 25)

---

## 4. 입력 시스템

### 4.1 입력 흐름
```
Touch/Mouse Event
  → InputManager (src/input/)
    → 드래그 길이 판정
      → 짧은 드래그: 아이템 선택 모드
      → 긴 드래그: 투척 모드 → Command 생성
        → GameScene → Sim.step(1, [command])
```

### 4.2 드래그 판정
```
DRAG_THRESHOLD = 40px (논리 픽셀)

if (dragLength < DRAG_THRESHOLD) → 아이템 선택 모드
else                             → 투척 모드
```

### 4.3 아이템 선택 모드
- 플레이어 주변에 보유 아이템이 원형으로 배치되어 나타남 (시각적 UI)
- 프로토타입에서는 자동으로 다음 아이템 선택 (명시적 선택 불필요)
- 확장 시: 탭으로 아이템 종류 선택

### 4.4 투척 모드
- 드래그 시작점 → 끝점 방향 = 던지는 방향
- 화살표 프리뷰 표시 (드래그 중)
- 릴리즈 시:
  1. 방향 벡터 계산
  2. 양자화: `dirQ = round(atan2(dy, dx) / (2π) * 1024) & 0x3FF`
  3. `THROW` 커맨드 생성
  4. Sim에 전달

---

## 5. 시뮬레이션 (Sim)

### 5.1 ISim 인터페이스
```typescript
interface ISim {
  reset(level: LevelData, seed: number): void;
  step(ticks: number, commands: Command[]): void;
  getSnapshot(): Snapshot;
}
```

### 5.2 Command 타입
```typescript
type Command = {
  type: 'THROW';
  tick: number;     // 발생 시점 tick
  dirQ: number;     // 양자화된 방향 (0~1023)
};
```

### 5.3 방향 양자화 ↔ 벡터 변환
```typescript
const DIR_STEPS = 1024;

// 양자화
function quantizeDir(dx: number, dy: number): number {
  const angle = Math.atan2(dy, dx);
  const q = Math.round((angle / (2 * Math.PI)) * DIR_STEPS);
  return ((q % DIR_STEPS) + DIR_STEPS) % DIR_STEPS;
}

// 역변환
function dirToVector(dirQ: number): { dx: number; dy: number } {
  const angle = (dirQ / DIR_STEPS) * 2 * Math.PI;
  return { dx: Math.cos(angle), dy: Math.sin(angle) };
}
```

### 5.4 투척 물리
```
IMPULSE = 상수 (튜닝 필요, 예: 200)

투척 시:
  dir = dirToVector(dirQ)  // 던지는 방향 단위벡터
  player.vx += (-dir.dx) * IMPULSE / player.mass
  player.vy += (-dir.dy) * IMPULSE / player.mass

  // 아이템은 월드에 생성되어 날아감 (선택적)
  // 프로토타입: 아이템은 시각적으로만 날아가거나, 바로 소멸
  player.inventory -= 1
```

### 5.5 이동 업데이트 (매 tick)
```
FRICTION = 0.999  // 미세 감쇠 (완전 0이면 영원히 떠다님)

player.x += player.vx * dt
player.y += player.vy * dt
player.vx *= FRICTION
player.vy *= FRICTION

// 잔해도 동일하게 이동
for each debris:
  debris.x += debris.vx * dt
  debris.y += debris.vy * dt
```

### 5.6 충돌 처리

#### 플레이어 ↔ 잔해
```
거리 = dist(player, debris)
if (거리 < player.radius + debris.radius):
  → 잔해 제거 (alive = false)
  → player.inventory += 1
```

#### 플레이어 ↔ 목표
```
거리 = dist(player, goal)
if (거리 < player.radius + goal.radius):
  → 게임 상태 = SUCCESS
```

#### 플레이어 ↔ 월드 경계 (선택적)
- 월드 크기를 제한하고, 경계에서 반사 또는 감쇠 반사
- 또는: 경계 없이 무한 공간 (카메라가 따라감)
- **프로토타입 선택**: 월드 경계 반사 (직사각형)

### 5.7 Snapshot
```typescript
interface Snapshot {
  tick: number;
  state: 'PLAYING' | 'SUCCESS' | 'FAIL';
  player: {
    x: number; y: number;
    vx: number; vy: number;
    radius: number;
    inventory: number;
  };
  goal: {
    x: number; y: number;
    radius: number;
  };
  debris: Array<{
    x: number; y: number;
    radius: number;
    alive: boolean;
  }>;
  // 던져진 아이템 (시각적 표현용)
  projectiles: Array<{
    x: number; y: number;
    vx: number; vy: number;
    radius: number;
  }>;
}
```

---

## 6. 렌더링

### 6.1 렌더 파이프라인
```
Snapshot → Renderer.draw(snapshot, canvas)
```

렌더러는 Snapshot만 읽는 순수 함수적 구조.

### 6.2 카메라
- 플레이어 중심 추적
- 부드러운 카메라 보간 (lerp)
```
camera.x += (player.x - camera.x) * CAMERA_LERP
camera.y += (player.y - camera.y) * CAMERA_LERP
```

### 6.3 그리기 순서
1. 배경 (검은색 + 별)
2. 월드 경계선 (선택적)
3. 목표 영역 (글로우 효과)
4. 잔해/아이템
5. 던져진 투사체
6. 플레이어 (로봇)
7. 드래그 화살표 프리뷰 (입력 중일 때)

### 6.4 비주얼 스타일
- 배경: 검정 (#000) + 작은 흰 점(별) 랜덤 배치
- 플레이어: 원 + 간단한 로봇 얼굴 (눈 2개, 안테나)
- 목표: 발광하는 원 (펄스 애니메이션)
- 잔해: 회색~노란색 원, 크기 약간 다양
- 투사체: 작은 밝은 원, 트레일 효과 (간단하게)

---

## 7. UI / HUD (DOM 오버레이)

### 7.1 레이아웃
```
┌──────────────────────────┐
│ [아이템: 5]    [Tick: 120]│  ← 상단 HUD
│                          │
│                          │
│      (Canvas 게임 영역)    │
│                          │
│                          │
│          [SUCCESS!]       │  ← 상태 표시 (조건부)
└──────────────────────────┘
```

### 7.2 HUD 요소
| 요소 | 위치 | 설명 |
|------|------|------|
| 아이템 수 | 좌상단 | `아이템: N` |
| 디버그 정보 | 우상단 | tick, 속도 크기 (토글) |
| 상태 메시지 | 중앙 | SUCCESS / FAIL (게임 종료 시) |

### 7.3 구현
- `<div id="hud">` Canvas 위에 absolute positioning
- z-index로 Canvas 위에 표시
- pointer-events: none (입력은 Canvas로 통과)
- 상태 변경 시만 DOM 업데이트 (매 프레임 X)

---

## 8. 리플레이 시스템

### 8.1 커맨드 로그
```typescript
interface ReplayData {
  levelId: string;
  seed: number;
  commands: Command[];
}
```

### 8.2 기록
- GameScene에서 Sim에 전달하는 모든 Command를 배열에 push

### 8.3 재생
1. 동일 `levelId` + `seed`로 `sim.reset()` 호출
2. tick별로 해당 tick의 Command를 모아 `sim.step(1, cmds)` 호출
3. 마지막 tick까지 재생 후 `getSnapshot().state` 확인
4. 원본 결과와 비교 → 일치하면 "Replay Verified", 불일치면 경고

### 8.4 ResultScene에서 사용
- "Replay" 버튼 클릭
- 빠른 재생 (시각적 표시 없이 빠르게 시뮬레이션)
- 결과 표시

---

## 9. 레벨 데이터

### 9.1 LevelData 구조
```typescript
interface LevelData {
  id: string;
  worldWidth: number;
  worldHeight: number;
  player: {
    x: number; y: number;
    inventory: number;
  };
  goal: {
    x: number; y: number;
    radius: number;
  };
  debris: Array<{
    x: number; y: number;
    vx?: number; vy?: number;
    radius?: number;
  }>;
}
```

### 9.2 프로토타입 스테이지
- 월드: 2000 × 3000 (세로가 긴 모바일 비율)
- 플레이어: 하단 중앙 시작, 인벤토리 3
- 목표: 상단 중앙
- 잔해: 중간에 10~15개 분포 (seed 기반 약간 변동)

### 9.3 Seed 기반 배치
- seed → 간단한 PRNG (예: mulberry32)
- 잔해 위치에 ±offset 적용
- 동일 seed면 동일 배치 보장 (리플레이 호환)

---

## 10. 캔버스 사이징 & 모바일 성능

### 10.1 사이징 전략
```typescript
const RENDER_SCALE = 0.7;
const MAX_DPR = 1.5;

function resize(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio, MAX_DPR);
  const w = window.innerWidth;
  const h = window.innerHeight;

  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.floor(w * dpr * RENDER_SCALE);
  canvas.height = Math.floor(h * dpr * RENDER_SCALE);
}
```

### 10.2 세이프 에어리어
```css
body {
  padding: env(safe-area-inset-top) env(safe-area-inset-right)
           env(safe-area-inset-bottom) env(safe-area-inset-left);
}
```

### 10.3 성능 가이드라인
- 오브젝트 20개 이하 유지
- 배경 별: 50개 이하, 매 프레임 다시 그리기 (또는 오프스크린 캔버스 캐싱)
- 그라데이션/그림자 최소화
- `requestAnimationFrame` 단일 루프

---

## 11. 구현 순서 (Phase)

### Phase 1: 기반
- [ ] Vite + TypeScript 프로젝트 초기화
- [ ] 캔버스 생성, 리사이즈, RAF 루프
- [ ] 씬 매니저 (TitleScene → GameScene → ResultScene 전환)

### Phase 2: 시뮬레이션
- [ ] ISim 인터페이스 정의
- [ ] JsSim 구현 (플레이어 이동, 투척 반동, 충돌)
- [ ] Snapshot 구조 정의
- [ ] 레벨 데이터 로드 + seed 기반 PRNG

### Phase 3: 입력
- [ ] 터치/마우스 드래그 감지
- [ ] 드래그 길이 판정 (선택 vs 투척)
- [ ] 방향 양자화 + Command 생성
- [ ] 드래그 화살표 프리뷰

### Phase 4: 렌더링
- [ ] 카메라 시스템 (플레이어 추적)
- [ ] 배경 (별)
- [ ] 오브젝트 렌더 (플레이어, 목표, 잔해, 투사체)
- [ ] 투척 프리뷰 화살표

### Phase 5: UI/HUD
- [ ] DOM 오버레이 구조
- [ ] 아이템 수 표시
- [ ] 디버그 정보 (토글)
- [ ] 상태 메시지 (Success/Fail)

### Phase 6: 리플레이
- [ ] 커맨드 로그 기록
- [ ] ResultScene에 Replay 버튼
- [ ] 리플레이 재생 + 검증

---

## 12. 향후 개선 (TODO)

- [ ] Rust WASM 물리 엔진 (`WasmSim` implements `ISim`)
- [ ] 다양한 아이템 타입 (질량/모양 차이)
- [ ] 멀티 스테이지 + 스테이지 선택
- [ ] 사운드 이펙트
- [ ] 파티클 시스템 (투척 시, 목표 도달 시)
- [ ] 온라인 리더보드 (최소 투척 횟수)
- [ ] PWA 지원 (오프라인 플레이)
- [ ] 투척 힘 조절 (드래그 길이에 비례)
- [ ] 장애물 (벽, 중력장)
- [ ] 튜토리얼 씬
