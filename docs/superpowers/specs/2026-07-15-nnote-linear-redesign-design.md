# Nnote Linear-inspired UI redesign

## Goal

Nnote의 기존 기능과 화면 흐름을 유지하면서 설치된 `DESIGN.md`의 Linear-inspired 원칙으로 모든 Renderer 화면을 일관되게 재설계한다. 현재 기능별 스크린샷은 Before 기준으로 영구 보존하고, 동일 상태의 After 스크린샷을 별도로 생성해 이후에도 전후를 직접 비교할 수 있게 한다.

## Locked scope

변경 대상은 Renderer의 시각 체계와 화면 구성이다.

- 대시보드와 새 회의
- 녹음 진행 상태
- 복구 가능 회의와 복구 선택 UI
- AI 처리 상태와 실패·재시도 UI
- 완료된 회의 문서
- 요약 템플릿 목록과 편집기
- API 키 설정
- 좁은 창에서의 반응형 배치

변경하지 않는 인접 영역은 다음과 같다.

- Electron Main, Preload, IPC 계약
- SQLite 스키마와 저장 경로
- 녹음, 복구, 처리, 내보내기·가져오기 동작
- 사용자 문구의 의미와 접근 가능한 이름
- Windows와 macOS 기능 범위

## Considered approaches

### Token-only reskin

기존 CSS 변수만 어두운 색으로 교체한다. 변경량은 작지만 기본 HTML에 가까운 템플릿·설정 화면과 불균형한 컴포넌트 구조를 해결하지 못한다.

### Shared component retrofit — selected

기존 React 흐름은 유지하면서 토큰, 공통 컨트롤, 패널, 상태 표시, 문서 섹션과 편집 행을 하나의 시각 언어로 통합한다. 기능 회귀 위험을 제한하면서 모든 화면을 실제로 개선할 수 있다.

### Navigation and information-architecture rewrite

사이드바와 새 라우팅 구조를 도입한다. 변화 폭은 크지만 제품 흐름과 포커스 복원 동작까지 다시 설계해야 하므로 이번 범위에서 제외한다.

## Design system

### Color

- Canvas: `#010102`
- Surface 1: `#0f1011`
- Surface 2: `#141516`
- Surface 3: `#18191a`
- Primary: `#5e6ad2`
- Primary hover: `#828fff`
- Ink: `#f7f8f8`
- Muted ink: `#d0d6e0`
- Subtle ink: `#8a8f98`
- Hairline: `#23252a`
- Strong hairline: `#34343a`

Lavender는 브랜드, 주요 CTA, 활성 상태와 포커스에만 사용한다. 실패·경고·복구 상태는 읽기 쉬운 제한된 semantic color를 허용하되 큰 배경 면으로 사용하지 않는다.

### Typography

Linear의 독점 폰트를 포함하지 않는다. Windows와 macOS에서 안정적인 다음 시스템 스택을 사용한다.

```css
font-family: Inter, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
```

표시 제목은 600, 본문은 400–500으로 제한한다. 기존 Georgia 제목을 제거하고 제목에는 음수 letter-spacing을 적용한다. 시간, 용량과 상태 ID만 시스템 monospace를 사용한다.

### Shape, spacing, depth

- 4px spacing base
- 버튼과 입력 8px radius
- 카드 12px radius
- 큰 문서 패널 16px radius
- 카드 padding 24px
- 기본 컨트롤 높이 40px 이상
- 그림자와 atmospheric gradient 제거
- surface 단계와 1px hairline으로 깊이 표현

### Shared controls

모든 `button`, `input`, `select`, `textarea`에 공통 기본 상태, hover, focus-visible, disabled 상태를 제공한다. 주요 동작만 lavender primary 버튼을 사용하고 나머지는 surface 기반 secondary 또는 transparent tertiary 버튼을 사용한다.

상태 badge는 동일한 크기·타이포그래피·radius를 사용한다. `completed`, `recorded`, `recording`, `failed`, `recoverable`은 색에만 의존하지 않고 기존 상태 텍스트를 유지한다.

## Screen design

### App chrome and dashboard

상단 바는 56px 높이의 near-black surface로 유지한다. 브랜드는 왼쪽, 기능 내비게이션은 오른쪽에 두며 활성·hover 상태를 surface lift로 표시한다.

대시보드는 기존 좌우 구조를 유지한다. 왼쪽 녹음 패널은 primary action과 실시간 telemetry의 대비를 강화하고, 오른쪽 기록 목록은 행 간격을 줄여 데스크톱 도구처럼 조밀하게 만든다. 그림자 대신 hairline과 surface 차이를 사용한다.

### Recording and recovery

녹음 중인 패널은 경과 시간, 저장 크기와 파트를 monospace metric tile로 표시한다. 일시정지는 secondary, 종료는 primary, 폐기는 danger treatment로 구분한다.

복구 가능 상태 badge뿐 아니라 복구 선택 dialog도 같은 dark surface, focus ring과 버튼 hierarchy를 사용한다. 배경 overlay는 검정 scrim으로 처리한다.

### Meeting detail

단일 문서 흐름은 유지한다. 헤더, 오디오, 처리 상태, export action을 하나의 상단 panel로 정돈하고 요약·결정·할 일·논의·화자·전사·Markdown 섹션은 hairline으로 구분한다.

긴 문서에서도 제목 크기를 과장하지 않고 최대 40px로 제한한다. Markdown preview는 surface-2와 monospace를 사용하며 문서 배경과 충분히 구분한다.

### Template editor

현재 기본 HTML 레이아웃을 제거한다. 템플릿 선택은 compact tab/list로, 이름 편집은 toolbar로, 각 섹션은 surface-2 편집 card로 렌더링한다. 제목·종류·지시문의 label과 input을 일정한 grid에 맞추고 이동·제거는 작은 secondary/danger action으로 정리한다.

기본 템플릿과 사용 중인 템플릿의 잠금 의미는 기존 로직과 문구를 유지한다.

### API key settings

설정 페이지를 status panel과 credential form으로 나눈다. configured 상태와 마지막 검증 시각을 badge와 보조 텍스트로 표시한다. 실제 키는 화면, fixture와 스크린샷에 절대 넣지 않는다. 삭제는 primary action과 분리된 danger zone으로 표시한다.

## Responsive behavior

- 980px 이하: 대시보드 열 비율과 padding 축소
- 720px 이하: 대시보드 단일 열, nav wrap, 문서 padding 축소
- 템플릿 section editor는 좁은 창에서 단일 열
- 버튼과 입력은 최소 40px, 좁은 화면에서 최소 44px 높이
- 전사 row는 좁은 화면에서 meta와 본문을 세로 배치
- 화면 폭 때문에 수평 스크롤이 생기지 않아야 한다

## Screenshot preservation and comparison

현재 `docs/screenshots/01-dashboard.png`부터 `07-api-key-settings.png`까지는 Before 이미지다. 이 파일은 수정하거나 덮어쓰지 않는다.

After 이미지는 다음 경로에 동일한 이름과 순서로 저장한다.

```text
docs/screenshots/after-linear/
  01-dashboard.png
  02-recording.png
  03-recovery.png
  04-processing-failed.png
  05-meeting-detail.png
  06-template-editor.png
  07-api-key-settings.png
```

`docs/screenshots/README.md`는 각 기능마다 Before와 After를 나란히 설명한다. 두 세트는 같은 Windows 1280×900 viewport, 같은 고정 날짜, 같은 회의·상태 fixture를 사용한다. 회의 상세는 전체 문서 높이를 캡처한다.

캡처 검증은 다음을 보장한다.

- Before 파일 7개의 기존 checksum은 변경되지 않는다.
- After 파일 7개가 모두 생성된다.
- 각 화면의 기능 heading과 핵심 action이 보인다.
- API 키 값과 authorization header가 포함되지 않는다.
- After 이미지 원본 픽셀을 각각 직접 확인한다.

## Accessibility and interaction

- 기존 role, label, heading과 keyboard flow 유지
- 모든 interactive control에 `:focus-visible` 제공
- text/background contrast는 WCAG AA를 목표로 검증
- 색만으로 상태를 표현하지 않음
- `prefers-reduced-motion`에서 decorative transition 제거
- destructive action은 기존 확인 흐름 유지

## Testing

### Paired regression coverage

- Linear redesign applies to the template editor; template mutation behavior remains unchanged.
- Linear redesign applies to API key settings; secret values remain absent from rendered status and screenshots.
- Dashboard appearance changes; recording start/stop behavior remains unchanged.
- Meeting detail appearance changes; speaker rename and export actions remain reachable.
- Narrow layout changes; desktop two-column dashboard remains intact.

### Verification gates

- lint and TypeScript
- existing 311 unit/integration tests
- existing real Electron E2E
- refreshed visual regression baselines after original pixel inspection
- seven After documentation screenshots and preserved Before checksums
- viewport checks at 1280×900 and 640×900
- final diff review limited to Renderer, visual tests, DESIGN.md and screenshot documentation

## GitHub release 0.0.1

리디자인과 After 스크린샷 검증이 끝난 동일 커밋을 첫 공개 배포 버전으로 사용한다.

- `package.json`과 lockfile 버전: `0.0.1`
- Git tag: `v0.0.1`
- GitHub repository: `jdeploys/NNote`
- GitHub Release title: `Nnote 0.0.1`
- 공개 상태: prerelease

릴리스 자산은 target OS의 GitHub-hosted runner에서 생성한다. native module을 다른 운영체제에서 교차 컴파일한 결과는 사용하지 않는다.

```text
Nnote-0.0.1-windows-x64.exe
Nnote-0.0.1-macos-x64.dmg
Nnote-0.0.1-macos-arm64.dmg
SHA256SUMS.txt
```

Windows job은 `windows-latest`에서 x64 NSIS installer를 만들고 unpacked 실행 파일의 Main, SQLite, keyring, Preload와 Renderer 로딩 신호를 검사한다.

macOS job은 macOS runner matrix에서 x64와 arm64 DMG를 각각 만든다. 각 architecture의 unpacked `.app`을 실행해 같은 runtime signal을 검사한다. macOS native module의 architecture가 대상과 일치하는지도 확인한다.

릴리스 workflow는 다음 순서로 동작한다.

1. lint, typecheck, unit/integration tests와 platform visual tests
2. target별 package build
3. unpacked runtime verification
4. 설치 자산과 SHA-256 checksum 수집
5. draft release에 자산 업로드
6. 모든 자산 이름, checksum과 runtime signal 확인
7. prerelease `v0.0.1` 공개

현재 저장소에는 Windows signing certificate 또는 Apple Developer signing/notarization secret이 없다. 따라서 `0.0.1` release note에 Windows SmartScreen과 macOS Gatekeeper 경고 가능성을 명시하고, signed/notarized라고 주장하지 않는다. signing secret이 나중에 제공되면 별도 릴리스 설계로 추가한다.

Git tag와 공개 Release 생성은 모든 로컬·CI 검증이 끝난 뒤 한 번만 수행한다. 일부 platform build가 실패하면 불완전한 공개 Release를 만들지 않는다.

## Non-goals

- Linear logo, proprietary font or copyrighted product assets 사용
- 새로운 기능, 새로운 라우팅 또는 데이터 모델 추가
- light theme와 theme switcher
- animation-heavy interactions
- Main/Preload/IPC refactor
- 이번 버전의 Authenticode signing, Apple code signing 또는 notarization
