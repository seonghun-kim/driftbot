# Driftbot — 진행 상황 보고서

> 작성일: 2026-02-17
> 버전: 0.1.0 (MVP 프로토타입)

---

## 1. 구현 현황

### 완료된 기능

| 기능 | 파일 | 상태 | 비고 |
|------|------|------|------|
| Vite + TypeScript 프로젝트 설정 | `package.json`, `tsconfig.json` | 완료 | strict 모드, 외부 의존성 0 |
| 씬 전환 (Title → Game → Result) | `src/app/scenes/*` | 완료 | SceneManager 패턴 |
| ISim 인터페이스 | `src/sim/ISim.ts` | 완료 | WASM 교체 준비 |
| JsSim 물리 시뮬레이션 | `src/sim/JsSim.ts` | 완료 | 투척 반동, 관성, 충돌, 경계 반사 |
| 터치/마우스 드래그 입력 | `src/input/InputManager.ts` | 완료 | PointerEvent 기반, 드래그 길이 판정 |
| Canvas 2D 렌더러 | `src/render/Renderer.ts` | 완료 | 카메라 추적, 오브젝트별 그리기 |
| DOM HUD 오버레이 | `src/ui/HUD.ts` | 완료 | 아이템 수, 디버그 정보 |
| 리플레이 시스템 | `ResultScene.ts` | 완료 | 커맨드 로그 → 재생 → 검증 확인됨 |
| 모바일 캔버스 사이징 | `index.html`, `Renderer.ts` | 완료 | renderScale=0.7, DPR cap 1.5, safe-area |
| 레벨 데이터 (level01) | `src/levels/level01.ts` | 완료 | seed 기반 PRNG 배치 |
| 방향 양자화 | `InputManager.ts` | 완료 | 0~1023 (DIR_STEPS=1024) |
| Seed 기반 PRNG | `src/sim/prng.ts` | 완료 | mulberry32, 결정론적 |

### 검증 결과

| 테스트 | 결과 |
|--------|------|
| TypeScript strict 빌드 (`tsc --noEmit`) | PASS |
| 타이틀 → 게임 씬 전환 | PASS |
| 드래그 투척 (반동으로 이동) | PASS |
| 잔해 획득 (접촉 시 인벤토리 +1) | PASS |
| 목표 도달 → SUCCESS 판정 | PASS |
| Result 씬 표시 (통계, 버튼) | PASS |
| REPLAY 버튼 → Replay Verified | PASS |
| RESTART → Title로 복귀 | PASS |

---

## 2. 코드 통계

### 파일별 라인 수

| 파일 | 라인 |
|------|------|
| `src/render/Renderer.ts` | 329 |
| `src/sim/JsSim.ts` | 258 |
| `src/app/scenes/GameScene.ts` | 116 |
| `src/input/InputManager.ts` | 110 |
| `src/app/scenes/ResultScene.ts` | 90 |
| `src/sim/types.ts` | 80 |
| `src/ui/HUD.ts` | 62 |
| `src/app/main.ts` | 58 |
| `src/app/scenes/TitleScene.ts` | 43 |
| `src/levels/level01.ts` | 32 |
| `src/app/scenes/SceneManager.ts` | 26 |
| `src/sim/constants.ts` | 10 |
| `src/sim/prng.ts` | 10 |
| `src/sim/ISim.ts` | 7 |
| **합계** | **1,231** |

### 의존성

- **런타임 의존성**: 0개
- **개발 의존성**: typescript ~5.9.3, vite ^7.3.1

---

## 3. 튜닝 파라미터 현재값

```
FIXED_DT          = 1/60     고정 timestep
IMPULSE           = 220      투척 반동 크기
FRICTION          = 0.9992   미세 감쇠
PLAYER_RADIUS     = 22       플레이어 반지름
PLAYER_MASS       = 1.0      플레이어 질량
DEFAULT_DEBRIS_RADIUS = 16   잔해 기본 반지름
DIR_STEPS         = 1024     방향 양자화 단계
PROJECTILE_SPEED  = 350      투사체 속도
PROJECTILE_RADIUS = 8        투사체 반지름
PROJECTILE_MAX_LIFE = 120    투사체 수명 (ticks)
RENDER_SCALE      = 0.7      렌더 해상도 배율
MAX_DPR           = 1.5      최대 디바이스 픽셀 비율
CAMERA_LERP       = 0.08     카메라 보간 속도
DRAG_THRESHOLD    = 40px     투척/선택 판정 임계값
```

---

## 4. 레벨 01 구성

```
월드: 2000 × 3000 (세로가 긴 모바일 비율)
플레이어: (1000, 2500), 인벤토리 5
목표: (1000, 300), 반지름 80
잔해: 13개 (상하로 분포, seed에 의해 ±30 변동)
```

---

## 5. 개발 중 발견/해결한 이슈

### 해결됨

| 이슈 | 원인 | 수정 |
|------|------|------|
| 투척 커맨드가 Sim에서 무시됨 | 포인터 이벤트와 RAF 루프 사이의 tick 불일치. 커맨드 생성 시점의 tick과 sim.step() 시점의 tick이 1 이상 차이남 | `flush()` 시점에 현재 sim tick으로 커맨드 재스탬핑 |
| `setPointerCapture` 에러로 드래그 상태 미설정 | 합성 이벤트(Playwright 테스트)에서 pointerId가 유효하지 않아 예외 발생, 이후 코드가 실행되지 않음 | `dragging = true`를 `setPointerCapture` 앞으로 이동 + try-catch |

### 알려진 이슈 (미해결, 위험도 낮음)

| 이슈 | 위험도 | 설명 |
|------|--------|------|
| DOM 비널 단언 (`!`) | 낮음 | HUD, Scene에서 `getElementById()!` 사용. HTML 구조가 변경되면 런타임 에러 가능 |
| 렌더러 private canvas 접근 | 낮음 | TitleScene/ResultScene에서 `this.renderer['canvas']` 브라켓 접근. 공개 getter 추가 권장 |
| InputManager destroy 미호출 | 낮음 | `destroy()` 메서드 존재하지만 호출되지 않음. 현재 단일 인스턴스라 문제없음 |

---

## 6. 아키텍처 준수 현황

| 설계 원칙 | 준수 |
|-----------|------|
| Sim-Render 분리 (Snapshot 기반) | O |
| ISim 인터페이스 (WASM 교체 대비) | O |
| 입력 → Command → Sim 단방향 | O |
| 고정 timestep (1/60s) | O |
| 방향 양자화 (결정론적 리플레이) | O |
| Flat 상태 구조 (WASM 이행 대비) | O |
| DOM HUD (pointer-events: none) | O |
| 카메라 플레이어 추적 (lerp) | O |

---

## 7. 다음 단계 (TODO)

### 즉시 개선 가능
- [ ] Renderer에 `getCanvas()` public getter 추가 (private 접근 제거)
- [ ] FAIL 조건 개선: 현재 "아이템 0 + 잔해 없음 + 속도 < 2"로 단순화. 목표 도달 가능성 판정 추가
- [ ] 드래그 화살표에 반동 방향(파란색) 더 강조
- [ ] 투사체에 간단한 트레일 이펙트 추가

### 중기 개선
- [ ] 다양한 아이템 타입 (질량/모양 차이)
- [ ] 멀티 스테이지 + 스테이지 선택 UI
- [ ] 사운드 이펙트 (투척, 획득, 성공/실패)
- [ ] 파티클 시스템 (투척 시, 목표 도달 시)
- [ ] 튜토리얼 씬

### 장기 개선
- [ ] Rust WASM 물리 엔진 (`WasmSim` implements `ISim`)
- [ ] 온라인 리더보드 (최소 투척 횟수)
- [ ] PWA 지원 (오프라인 플레이)
- [ ] 투척 힘 조절 (드래그 길이에 비례)
- [ ] 장애물 (벽, 중력장)

---

## 8. 실행 방법

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 프로덕션 빌드
npm run preview    # 빌드 결과 미리보기
```

### 조작
- **드래그 (길게)**: 드래그 방향으로 아이템 투척 → 반대 방향으로 반동 이동
- **드래그 (짧게)**: 아이템 선택 (프로토타입에서는 자동 선택)
- 투척 힘은 고정, **방향만** 조절
