# Driftbot — 상세 설계 문서

## 1. 게임 컨셉

### 핵심 메카닉
- 우주 공간(마찰 ≈ 0)에서 **물건을 던져 생기는 반동**으로만 이동
- **벽 라이딩**: 벽(세그먼트)에 접촉하면 WALL 모드로 전환, 벽 표면을 따라 이동
- **Space / Wall 듀얼 모드**: SPACE 모드에서는 투척, WALL 모드에서는 벽 점프로 이동
- **벽 점프**: WALL 모드에서 드래그 방향으로 벽을 차고 점프 (인벤토리 소모 없음)
- 플레이어(로봇)는 초기 아이템을 가지고 출발
- 떠다니는 잔해를 접촉으로 획득 → 인벤토리에 추가
- 방향만 결정, 투척 힘은 고정

### 승리/실패 조건
| 조건 | 판정 |
|------|------|
| 승리 | 모든 목표에 도달 (플레이어 원 ∩ 각 목표 원) |
| 실패 | SPACE 모드에서 `inventory === 0`이고 속도가 낮을 때 → FAIL |

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
  mode: 'SPACE' | 'WALL';  // 현재 모드
  wallSegIdx: number; // WALL 모드 시 부착된 세그먼트 인덱스 (-1이면 없음)
  wallT: number;      // WALL 모드 시 세그먼트 상의 위치 (0~1)
}
```

### 3.2 목표 (Goal)
```typescript
interface LevelGoalData {
  x: number;
  y: number;
  radius: number;
  vx?: number;  // 이동 속도 (벽에 반사)
  vy?: number;
}
```
- 스테이지당 1~3개의 목표가 존재 (다중 목표 시스템)
- 목표는 속도가 지정되면 월드 내에서 이동하며 세그먼트에 반사됨
- 모든 목표에 도달해야 SUCCESS

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

### 3.4 세그먼트 (Segment)
```typescript
type Segment = {
  ax: number; ay: number;  // 시작점
  bx: number; by: number;  // 끝점
};
```

### 3.5 스냅샷 타겟 (SnapshotTarget)
```typescript
type SnapshotTarget = {
  type: 'MOVE' | 'JUMP';
  segIdx: number;       // 대상 세그먼트 인덱스
  sQ: number;           // 세그먼트 상의 양자화된 위치
  x: number; y: number; // 월드 좌표
  dirQ?: number;        // JUMP 타겟의 점프 방향 (양자화)
};
```

### 3.6 성능 예산
- 화면 내 오브젝트: 20개 전후 (플레이어 1 + 목표 1~3 + 잔해 10~20)
- 충돌 검사: 브루트포스 O(n²) 허용 (n ≤ 25)

---

## 4. 입력 시스템

### 4.1 입력 흐름
```
Touch/Mouse Event
  → InputManager (src/input/)
    → RawGesture 생성 (TAP, SHORT_DRAG, LONG_DRAG)
      → GameScene
        → 플레이어 모드(SPACE/WALL)에 따라 Command로 변환
          → Sim.step(1, [command])
```

### 4.2 RawGesture 타입
```typescript
interface RawGesture {
  type: 'TAP' | 'SHORT_DRAG' | 'LONG_DRAG';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  dirQ: number; // quantized direction (for drags; 0 for taps)
}
```

InputManager는 터치/마우스 이벤트를 RawGesture로만 변환하며, Command 생성 책임은 GameScene에 있다.

### 4.3 DragClassification (드래그 분류)

드래그 시작 시 한 번 분류하고, 드래그가 끝날 때까지 잠금(lock):

```typescript
type DragClassification =
  | { type: 'NONE' }
  | { type: 'PLAYER'; startMode: PlayerMode }
  | { type: 'RESERVE'; segIdx: number; t: number; x: number; y: number; startMode: PlayerMode };
```

- `NONE` = 드래그 없음 또는 상호작용 불가 영역 드래그 → 커맨드 없음, 기즈모 없음
- `PLAYER` = 플레이어 근처에서 시작 → THROW (SPACE) 또는 WALL_JUMP (WALL)
- `RESERVE` = 예측 지점 근처에서 시작 → WALL_RESERVE_JUMP

분류 우선순위: RESERVE > PLAYER > NONE

### 4.4 드래그 판정
```
TAP_MAX_DIST = 15px (논리 픽셀)
DRAG_THRESHOLD = 40px (논리 픽셀)

if (dragLength < TAP_MAX_DIST)   → TAP
if (dragLength < DRAG_THRESHOLD) → SHORT_DRAG
else                             → LONG_DRAG
```

### 4.5 모드별 제스처 → 커맨드 매핑

#### SPACE 모드
| 제스처 | DragClassification | 커맨드 | 설명 |
|--------|-------------------|--------|------|
| LONG_DRAG | PLAYER | `THROW` | 반동 투척 (인벤토리 소모) |
| LONG_DRAG | NONE | *(없음)* | 빈 공간 드래그 무시 |

#### WALL 모드
| 제스처 | DragClassification | 커맨드 | 설명 |
|--------|-------------------|--------|------|
| TAP | *(무관)* | `WALL_TAP` | 벽 위 이동 방향 전환 |
| LONG_DRAG | RESERVE | `WALL_RESERVE_JUMP` | 점프 방향 예약 |
| LONG_DRAG | PLAYER | `WALL_JUMP` | 벽 점프 실행 |
| LONG_DRAG | NONE | *(없음)* | 빈 공간 드래그 무시 |

### 4.6 투척 모드 (SPACE)
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
type Command =
  | { type: 'THROW'; tick: number; dirQ: number }
  | { type: 'WALL_TAP'; tick: number; segIdx: number; sQ: number }
  | { type: 'WALL_RESERVE_JUMP'; tick: number; segIdx: number; sQ: number; dirQ: number }
  | { type: 'WALL_JUMP'; tick: number; dirQ: number };
```
- `WALL_TAP`: 탭한 지점의 세그먼트 인덱스(`segIdx`)와 양자화 위치(`sQ`)로 이동 타겟 설정
- `WALL_RESERVE_JUMP`: 예약 점프 지점(`segIdx`, `sQ`)과 점프 방향(`dirQ`) 저장

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
IMPULSE = 25

투척 시:
  dir = dirToVector(dirQ)  // 드래그 방향 = 이동 방향
  player.vx += dir.dx * IMPULSE / player.mass
  player.vy += dir.dy * IMPULSE / player.mass

  // 잔해는 반대 방향으로 투척 (반작용)
  // 투척된 잔해는 월드에 남아 다시 획득 가능
  player.inventory -= 1
```

### 5.5 벽 시스템 (Wall System)

#### 세그먼트 기반 벽
- 벽은 직사각형이 아닌 **선분(line segment)** 으로 정의
- 연결된 세그먼트들은 **벽 체인(wall chain)** 을 구성
- 플레이어가 세그먼트에 접촉하면 `mode = 'WALL'`로 전환

#### WALL 모드 이동
```
WALL_MOVE_SPEED = 상수 (튜닝 필요)

WALL 모드일 때 (매 tick):
  wallT += WALL_MOVE_SPEED * moveDir * dt
  if wallT > 1 → 체인의 다음 세그먼트로 이동 (wallSegIdx 갱신)
  if wallT < 0 → 체인의 이전 세그먼트로 이동 (wallSegIdx 갱신)
  player.x, player.y = segment 위의 wallT 위치로 갱신
```

#### WALL 커맨드 처리
- `WALL_TAP`: 탭 지점의 세그먼트/위치를 이동 타겟으로 설정
- `WALL_RESERVE_JUMP`: 점프 방향 예약 (segIdx, sQ, dirQ 저장)
- `WALL_JUMP`: 벽에서 이탈, dirQ 방향으로 점프 임펄스 적용 → `mode = 'SPACE'`

#### wallSide 트래킹
- 플레이어는 세그먼트의 어느 쪽에 부착되어 있는지 `wallSide` (1 or -1)로 추적
- `wallSide * segmentNormal` = 실제 바깥쪽 법선 방향
- 세그먼트 전환 시 이전 법선과 새 법선의 내적으로 wallSide를 갱신
- 점프 시 wallSide 기반 법선으로 벽 방향 보정

### 5.6 타겟 시스템 (Target System)

#### Move 타겟
- WALL 모드에서 벽 위의 이동 가능한 지점
- `SnapshotTarget { type: 'MOVE', segIdx, sQ, x, y }`
- TAP 시 기존 타겟을 모두 교체

#### Jump 타겟
- WALL 모드에서 점프 가능한 방향/착지 지점
- `SnapshotTarget { type: 'JUMP', segIdx, sQ, x, y, dirQ }`
- 여러 개의 JUMP 타겟을 체인으로 연결 가능

#### 타겟 체인 매칭
- `WALL_RESERVE_JUMP` 시 기존 JUMP 타겟과 30단위 이내 근접 매칭
- 매칭 성공 시 해당 타겟을 교체하고 이후 타겟을 제거 (체인 절단)
- 매칭 실패 시 체인 끝에 추가

#### 보정 점프 (Correction Jump)
- JUMP 타겟에 도달할 때, 실제 착지점과 예약 지점의 편차가 40 이상이면 자동 보정 점프 발생
- 보정 점프는 원래 타겟 방향으로 재점프하여 오차를 최소화

#### 우선순위
- 타겟은 **호장 거리(arc-length)** 기준으로 가까운 순으로 처리

### 5.7 이동 업데이트 (매 tick)
```
FRICTION = 0.9992  // 미세 감쇠 (1.0 = 감쇠 없음)

player.x += player.vx * dt
player.y += player.vy * dt
player.vx *= FRICTION
player.vy *= FRICTION

// 잔해도 동일하게 이동
for each debris:
  debris.x += debris.vx * dt
  debris.y += debris.vy * dt
```

### 5.8 충돌 처리

#### 플레이어 ↔ 세그먼트
```
SPACE 모드일 때 매 tick:
  for each segment:
    dist = pointToSegmentDist(player, segment)
    if (dist < player.radius):
      → player.mode = 'WALL'
      → player.wallSegIdx = segmentIndex
      → player.wallT = 세그먼트 상 최근접점의 t값
      → player.vx = 0, player.vy = 0
```

#### 플레이어 ↔ 잔해
```
거리 = dist(player, debris)
if (거리 < player.radius + debris.radius):
  → 잔해 제거 (alive = false)
  → player.inventory += 1
```

#### 플레이어 ↔ 목표
```
for each goal:
  if (goal.reached) continue
  거리 = dist(player, goal)
  if (거리 < player.radius + goal.radius):
    → goal.reached = true

if (모든 goal이 reached):
  → 게임 상태 = SUCCESS
```

#### 플레이어 ↔ 월드 경계
- 월드 경계 = 4개의 자동 생성 경계 세그먼트 (bottom, right, top, left)
- `worldWidth × worldHeight` 기반으로 초기화 시 자동 생성
- 경계 세그먼트도 일반 세그먼트와 동일하게 벽 라이딩 가능

### 5.9 Snapshot
```typescript
interface Snapshot {
  tick: number;
  state: 'PLAYING' | 'SUCCESS' | 'FAIL';
  worldWidth: number;
  worldHeight: number;
  player: {
    x: number; y: number;
    vx: number; vy: number;
    radius: number;
    inventory: number;
    mode: 'SPACE' | 'WALL';
    wallSegIdx: number;
    wallT: number;
  };
  goals: Array<{
    x: number; y: number;
    vx: number; vy: number;
    radius: number;
    reached: boolean;
  }>;
  debris: Array<{
    x: number; y: number;
    radius: number;
    alive: boolean;
  }>;
  segments: Segment[];          // 벽 세그먼트 (경계 포함)
  targets: SnapshotTarget[];    // 현재 사용 가능한 타겟 목록
}
```

---

## 6. 렌더링

### 6.1 렌더 파이프라인
```
Snapshot → Renderer.draw(snapshot, inputState?, dc?, paused?)
```

렌더러는 Snapshot만 읽는 순수 함수적 구조. 입력 상태와 드래그 분류는 기즈모 표시용.

### 6.2 카메라
- 플레이어 중심 추적
- 부드러운 카메라 보간 (lerp)
- **에임 드래그 중 카메라 프리즈**: RESERVE 드래그 또는 WALL 모드 PLAYER 드래그 시 카메라 이동 정지 (조준 안정성 확보)
```
if (!isAimDrag):
  camera.x += (player.x - camera.x) * CAMERA_LERP
  camera.y += (player.y - camera.y) * CAMERA_LERP
```

### 6.3 그리기 순서
1. 배경 (검은색 + 별, 패럴랙스)
2. 월드 경계 (점선 사각형)
3. 내부 세그먼트 (인덱스 4+, 3중 레이어: glow/core/bright)
4. 타겟 마커 (MOVE=녹색 점, JUMP=주황 펄스+화살표)
5. 목표 영역 (글로우 효과, 달성 시 페이드)
6. 잔해/아이템
7. 플레이어 (로봇, 모드별 색상)
8. 궤적 예측 (점선 경로 + 다이아몬드 착지 마커)
9. 체인 예측 (JUMP 타겟 기반 연쇄 궤적)
10. 드래그 화살표 프리뷰 (입력 중일 때, dc != NONE)
11. Pause 딤 오버레이 (pause 중일 때)

### 6.4 비주얼 스타일
- 배경: 검정 (#000) + 작은 흰 점(별) 랜덤 배치
- 플레이어: 원 + 간단한 로봇 얼굴 (눈 2개, 안테나)
- 목표: 발광하는 원 (펄스 애니메이션)
- 잔해: 회색~노란색 원, 크기 약간 다양
- 세그먼트(벽): 밝은 선, 플레이어 부착 시 하이라이트
- 타겟 마커: MOVE=작은 원, JUMP=방향 화살표

---

## 7. UI / HUD (DOM 오버레이)

### 7.1 레이아웃
```
┌──────────────────────────────────┐
│ [SPACE | ITEMS:5 GOALS:1/3]  [⏸]│  ← 상단 HUD (좌: 상태, 우: 디버그+pause)
│                                  │
│         (Canvas 게임 영역)         │
│                                  │
│           [PAUSED]               │  ← 상태 표시 (조건부)
│           [SUCCESS!]             │
└──────────────────────────────────┘
```

### 7.2 HUD 요소
| 요소 | 위치 | 설명 |
|------|------|------|
| 모드 + 상태 | 좌상단 | `SPACE \| ITEMS: N  GOALS: R/T` (WALL 시 `TGT:N` 추가) |
| 디버그 정보 | 우상단 | `T:<tick> V:<speed>` (토글) |
| Pause 버튼 | 우상단 | ⏸/▶ 토글 (44px 터치 타겟, `pointer-events: auto`) |
| 상태 메시지 | 중앙 | PAUSED / SUCCESS / FAIL (조건부) |

### 7.3 구현
- `<div id="hud">` Canvas 위에 absolute positioning
- z-index로 Canvas 위에 표시
- pointer-events: none (입력은 Canvas로 통과)
- 상태 변경 시만 DOM 업데이트 (매 프레임 X)

### 7.4 Pause 모드

게임 중 시간을 일시정지하고, 정지 상태에서 예약 점프(WALL_RESERVE_JUMP)만 편집할 수 있다.

#### 입력 제한
| 제스처 | DragClassification | 결과 |
|--------|-------------------|------|
| LONG_DRAG | RESERVE | `WALL_RESERVE_JUMP` 생성 (허용) |
| LONG_DRAG | PLAYER | 기즈모 표시만, 커맨드 미생성 (차단) |
| TAP | *(무관)* | 무시 (차단) |

#### 시뮬레이션 처리
- pause 중 커맨드가 생성되면 `sim.step(1, commands)`로 1틱만 진행 (커맨드 적용)
- 커맨드가 없으면 sim.step 호출하지 않음 (완전 정지)
- resume 시 `accumulator = 0`으로 초기화 (시간 폭주 방지)

#### 시각 표시
- 반투명 딤 오버레이 (`rgba(0,0,0,0.3)`)
- HUD 중앙에 "PAUSED" 텍스트
- pause 버튼 아이콘 ▶ 로 전환

---

## 8. 리플레이 시스템

### 8.1 커맨드 로그
```typescript
interface ReplayData {
  levelId: string;
  seed: number;
  commands: Command[];
  finalState: GameState;   // 최종 게임 상태
  finalTick: number;       // 최종 틱
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
  goals: LevelGoalData[];  // 1~3개의 목표 (이동 가능)
  debris: Array<{
    x: number; y: number;
    vx?: number; vy?: number;
    radius?: number;
  }>;
  segments?: Segment[];  // 벽 세그먼트 (경계는 자동 생성)
}
```

### 9.2 스테이지 시스템 (절차적 생성)

10개 스테이지가 `stages.ts`에서 절차적으로 생성됨:

| 파라미터 | 공식 |
|---------|------|
| 월드 크기 | `(250 + stage*10) × (350 + stage*15)` |
| 목표 수 | stage 1~3: 1개, 4~6: 2개, 7~10: 3개 |
| 목표 반지름 | `15 - min(stage, 4)` (작아짐) |
| 목표 이동 속도 | `8 + stage * 1.5` (빨라짐) |
| 인벤토리 | `max(3, 10 - stage + goalCount)` |
| 잔해 수 | `3 + floor(stage / 2)` |
| 내부 세그먼트 | stage 2+부터 추가 (최대 6개) |

- 플레이어: 하단 중앙 시작, 벽(bottom 경계) 부착 상태
- 목표: 상단 영역에 균등 분배
- 잔해: 중간 영역에 격자 배치 + seed 기반 ±offset

### 9.3 Seed 기반 배치
- seed → mulberry32 PRNG
- 잔해 위치에 ±30 offset 적용
- 잔해 초기 속도에 ±5 랜덤 적용
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

### 10.3 튜닝 상수 (constants.ts)

| 상수 | 값 | 설명 |
|------|------|------|
| `FIXED_DT` | `1/60` | 고정 timestep |
| `IMPULSE` | `25` | 투척 임펄스 강도 |
| `FRICTION` | `0.9992` | 속도 감쇠 계수 |
| `PLAYER_RADIUS` | `16` | 플레이어 반지름 |
| `PLAYER_MASS` | `1.0` | 플레이어 질량 |
| `DIR_STEPS` | `1024` | 방향 양자화 단계 |
| `DRAG_THRESHOLD` | `40` | 드래그/탭 판정 경계 (px) |
| `WALL_ATTACH_DIST` | `PLAYER_RADIUS + 0.2` | 벽 부착 판정 거리 |
| `WALL_MOVE_SPEED` | `4` | 벽 위 이동 속도 (units/s) |
| `WALL_JUMP_SPEED` | `56` | 벽 점프 초기 속도 (units/s) |

### 10.4 성능 가이드라인
- 오브젝트 20개 이하 유지
- 배경 별: 60개, 매 프레임 다시 그리기
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
- [ ] JsSim 구현 (투척 반동, 벽 라이딩, 벽 점프, 충돌)
- [ ] 세그먼트 기반 벽 시스템 + 경계 자동 생성
- [ ] 타겟 시스템 (Move/Jump 타겟)
- [ ] Snapshot 구조 정의
- [ ] 레벨 데이터 로드 + seed 기반 PRNG

### Phase 3: 입력
- [ ] 터치/마우스 드래그 감지
- [ ] RawGesture 생성 (TAP, SHORT_DRAG, LONG_DRAG)
- [ ] GameScene에서 모드별 제스처 → Command 변환
- [ ] 드래그 화살표 프리뷰

### Phase 4: 렌더링
- [ ] 카메라 시스템 (플레이어 추적)
- [ ] 배경 (별)
- [ ] 오브젝트 렌더 (플레이어, 목표, 잔해, 세그먼트, 타겟)
- [ ] 투척 프리뷰 화살표

### Phase 5: UI/HUD
- [ ] DOM 오버레이 구조
- [ ] 모드 표시 (SPACE/WALL)
- [ ] 아이템 수 / 타겟 수 표시
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
- [x] 멀티 스테이지 (10단계 절차적 생성 구현 완료)
- [ ] 스테이지 선택 UI
- [ ] 사운드 이펙트
- [ ] 파티클 시스템 (투척 시, 목표 도달 시)
- [ ] 온라인 리더보드 (최소 투척 횟수)
- [ ] PWA 지원 (오프라인 플레이)
- [ ] 투척 힘 조절 (드래그 길이에 비례)
- [ ] 중력장 장애물
- [ ] 튜토리얼 씬
