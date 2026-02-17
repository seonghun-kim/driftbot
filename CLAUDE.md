# Driftbot — 우주 드리프트 퍼즐 프로토타입

## 프로젝트 개요
반동(투척) + 벽 라이딩으로 이동하는 우주 드리프트 퍼즐 웹게임.
Canvas 2D + TypeScript. 모바일 우선(2400급 해상도).

## 기술 스택
- **빌드**: Vite + TypeScript (strict)
- **렌더링**: Canvas 2D API (WebGL 사용 금지)
- **외부 라이브러리**: 최소화 (Vite 빌드 도구만)
- **패키지 매니저**: npm

## 프로젝트 구조
```
src/
├── app/          # 씬 관리, 게임 루프, 엔트리포인트
│   ├── scenes/   # TitleScene, GameScene (루프 내장), ResultScene
│   └── main.ts   # 엔트리포인트
├── sim/          # 시뮬레이션 코어 (물리, 상태)
│   ├── ISim.ts   # 시뮬레이션 인터페이스
│   ├── JsSim.ts  # JS 구현체 (Space/Wall 듀얼 모드)
│   ├── wallGeometry.ts  # 세그먼트 기하학 + 궤적 예측
│   ├── constants.ts     # 튜닝 상수 (IMPULSE, FRICTION 등)
│   ├── prng.ts          # mulberry32 PRNG
│   └── types.ts  # Snapshot, Command, Segment, LevelData 등
├── render/       # Canvas 2D 렌더러 (Snapshot → 화면)
├── input/        # 터치/마우스 입력 → RawGesture 생성
├── ui/           # DOM 오버레이 HUD
└── levels/       # 스테이지 데이터 (stages.ts 절차적 생성)
```

## 아키텍처 핵심 원칙

### Sim-Render 분리
- 렌더러는 `Snapshot`만 읽는다. Sim 상태를 직접 변경하지 않는다.
- 입력은 `RawGesture` → `Command`로 변환하여 Sim에 전달한다.
- `ISim` 인터페이스를 통해 물리 엔진 교체 가능 (→ 추후 Rust WASM).

### Space/Wall 듀얼 모드
- **SPACE 모드**: 관성 이동, 투척(THROW)으로 반동 이동, 벽 접촉 시 WALL로 전환
- **WALL 모드**: 벽 체인 위를 이동, 탭으로 이동 타겟 설정, 드래그로 점프/예약 점프

### 벽 시스템
- 벽은 선분(Segment: `{ax, ay, bx, by}`)으로 정의
- 월드 경계 = 4개 자동 생성 세그먼트 (bottom, right, top, left)
- 연결된 세그먼트는 체인(Chain)을 형성, 벽 라이딩 경로로 사용

### ISim 인터페이스
```typescript
interface ISim {
  reset(level: LevelData, seed: number): void;
  step(ticks: number, commands: Command[]): void;
  getSnapshot(): Snapshot;
}
```

### 결정론적 시뮬레이션
- 고정 timestep 1/60s.
- 방향은 양자화(0~1023) → 부동소수점 재현성 확보.
- 커맨드 로그 기록 → 리플레이 검증 가능.

## 빌드 & 실행
```bash
npm install
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드
npm run preview  # 빌드 결과 미리보기
```

## 코딩 컨벤션
- TypeScript strict 모드
- 상태 구조체는 "평평하게" 유지 (배열/단순 구조) — WASM 이행 대비
- 물리 연산에서 Math.sin/cos 등은 양자화된 방향값 기반으로 수행
- Canvas 드로잉은 `render/` 내에서만 수행
- DOM 조작은 `ui/` 내에서만 수행

## 주의사항
- WebGL, PixiJS 등 WebGL 기반 렌더링 사용 금지
- tsconfig, ESLint, Vite 설정은 명시적 요청 없이 수정하지 말 것
- 외부 라이브러리 추가 시 반드시 사유 확인
- 모바일 성능: `renderScale=0.7`, `effectiveDPR = min(devicePixelRatio, 1.5)`

## 디버그
- HUD에서 모드(SPACE/WALL), tick, 속도 크기 표시 (토글 가능)
- 커맨드 로그는 ResultScene에서 리플레이 검증에 사용

## 설계 문서
- 상세 설계: `docs/design.md`
- 아키텍처 다이어그램: `docs/architecture.md`
- 진행 상황: `docs/progress.md`
