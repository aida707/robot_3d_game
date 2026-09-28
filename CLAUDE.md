# MECH TACTICS (robot_3d_game)

Three.js + Vite + TypeScript로 만든 웹 3D 로봇 자동전투 게임.

## 설계 문서 규칙
- **게임플레이·밸런스·시스템 작업 전에 반드시 [GAME_DESIGN.md](GAME_DESIGN.md)를 읽는다.**
- 수치(무기/적/스테이지/경제), 시스템, 로드맵 진행 상황이 바뀌면 GAME_DESIGN.md의 해당 표와 **변경 이력**을 같은 작업 안에서 갱신한다.
- 데이터 파일(`src/data/*.ts`)과 GAME_DESIGN.md의 수치 표가 어긋나지 않게 유지한다.

## 명령
- `npm install`: 의존성 설치
- `npm run dev`: 개발 서버 (http://localhost:5173)
- `npm run build`: 타입 체크 + 프로덕션 빌드 (기준 경로 `/robot_3d_game/`)
- `npm run preview`: 빌드 결과를 GitHub Pages와 같은 경로로 띄워 확인 (http://localhost:4173/robot_3d_game/)

## 저장소와 배포
- GitHub: https://github.com/aida707/robot_3d_game (브랜치 `main`)
- `main`에 push하면 `.github/workflows/deploy.yml`이 빌드해서 GitHub Pages에 배포한다 → https://aida707.github.io/robot_3d_game/
- 기준 경로는 `vite.config.ts`의 `base`에서 빌드·preview일 때만 `/robot_3d_game/`. 에셋 경로는 반드시 `import.meta.env.BASE_URL`을 붙인다 (절대 경로 `/...` 금지).
- `asset_backup/`(원본 에셋 팩)은 저장소에 올리지 않는다.
- 커밋·push는 사용자가 요청할 때만 한다.

## 구조
- `src/main.ts`: 화면 흐름 (스테이지 선택 → 브리핑 → 격납고 → 전투 → 결과)
- `src/data/`: 무기·적·스테이지·로봇·코어 모듈·연구·전술 칩 데이터 (밸런스 조정은 여기서)
- `src/game/`: 타입, 피해 공식, 전투 로직(`Battle.ts`), 저장(구버전 저장 데이터 병합 포함), 최종 스탯 계산(`stats.ts`)
- `src/dev/balance.ts`: 개발 서버 전용. 브라우저 콘솔 `balance.simulate(...)`로 헤드리스 밸런스 검증 (사용법은 GAME_DESIGN.md 12절). 밸런스를 바꾸면 이걸로 검증하고 결과를 12절에 기록한다.
- `src/engine/`: Three.js 렌더링·카메라 (`Arena.ts`), 모델(절차적 + glTF, `models.ts`/`assets.ts`), 이펙트, 체력바, 피해 숫자
- `src/audio/`: 효과음(`sfx.ts`, 합성 + 샘플)과 절차적 BGM(`music.ts`)
- `src/data/assets.ts`: 외부 에셋 매니페스트 (파일은 `public/`에). 비어 있으면 절차적 대체. 사용법은 GAME_DESIGN.md 10절
- `scripts/make-test-model.mjs`: 에셋 파이프라인 검증용 테스트 glb 생성 (`node scripts/make-test-model.mjs`)
- `viewer.html` + `src/dev/viewer.ts`: 개발용 모델 뷰어 (`/viewer.html`). 모델 목록은 `vite.config.ts`의 `/__models` 엔드포인트가 제공한다
- `.claude/launch.json`: Claude가 확인용으로 5174 포트에 별도 개발 서버를 띄울 때 쓴다 (사용자 서버는 5173)
- `launcher/`: 바탕화면 바로가기용 실행기(`start-game.vbs`), 아이콘(`mech-tactics.ico`, `scripts/make-icon.mjs`로 생성), 바로가기 재생성 스크립트(`create-shortcut.ps1`, UTF-8 BOM 필요)
- 브라우저 기본 `confirm()`/`alert()`는 쓰지 않는다 (앱 내 브라우저에서 차단됨). `ui/screens.ts`의 `confirmDialog`를 쓴다.
- `src/ui/screens.ts`: HTML 오버레이 UI
- UI 텍스트와 주석은 한국어로 작성한다.
- 외부 에셋(모델·사운드) 다운로드는 사용자 승인을 받은 뒤에만 한다. CC0 등 라이선스를 확인한다.
