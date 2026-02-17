# Driftbot — 우주 드리프트 퍼즐 프로토타입

## 프로젝트 개요
반동(투척)으로만 이동하는 우주 드리프트 퍼즐 웹게임 MVP.
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
│   ├── scenes/   # TitleScene, GameScene, ResultScene
│   ├── loop.ts   # requestAnimationFrame 루프 + 고정 timestep
│   └── main.ts   # 엔트리포인트
├── sim/          # 시뮬레이션 코어 (물리, 상태)
│   ├── ISim.ts   # 시뮬레이션 인터페이스
│   ├── JsSim.ts  # JS 구현체
│   └── types.ts  # Snapshot, Command, LevelData 등
├── render/       # Canvas 2D 렌더러 (Snapshot → 화면)
├── input/        # 터치/마우스 입력 → Command 변환
├── ui/           # DOM 오버레이 HUD
└── levels/       # 스테이지 데이터 (JSON)
```

## 아키텍처 핵심 원칙

### Sim-Render 분리
- 렌더러는 `Snapshot`만 읽는다. Sim 상태를 직접 변경하지 않는다.
- 입력은 `Command` 객체로 변환하여 Sim에 전달한다.
- `ISim` 인터페이스를 통해 물리 엔진 교체 가능 (→ 추후 Rust WASM).

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
- HUD에서 tick, 속도 크기 표시 (토글 가능)
- 커맨드 로그는 ResultScene에서 리플레이 검증에 사용

## 설계 문서
- 상세 설계: `docs/design.md`
- 아키텍처 다이어그램: `docs/architecture.md`
