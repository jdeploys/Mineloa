# API 키 설정 한국어 문구 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** API 키 설정 카드의 사용자 노출 문구를 자연스러운 한국어로 통일한다.

**Architecture:** 기존 `ApiKeySettings` 컴포넌트의 하드코딩된 영어 문자열만 한국어로 교체한다. 상태 관리와 Desktop API 호출 흐름은 그대로 두고 컴포넌트 테스트와 문서용 스크린샷으로 결과를 검증한다.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Playwright

## Global Constraints

- `OpenAI`와 `API` 표기는 유지한다.
- 저장·삭제·상태 갱신 동작과 비밀 키 비노출 보장은 변경하지 않는다.
- 다른 화면의 문구는 변경하지 않는다.

---

### Task 1: API 키 설정 카드 한국어화

**Files:**
- Modify: `tests/unit/api-key-settings.test.tsx`
- Modify: `src/renderer/src/features/settings/ApiKeySettings.tsx`
- Modify: `docs/screenshots/07-api-key-settings.png`
- Modify: `docs/screenshots/after-linear/07-api-key-settings.png`

**Interfaces:**
- Consumes: `ApiKeySettings({ settings }: ApiKeySettingsProps)`와 기존 `SettingsApi`
- Produces: 동일한 컴포넌트 인터페이스와 한국어 접근성 이름

- [ ] **Step 1: 한국어 표시와 비변경 보안 동작을 검사하는 테스트 작성**

  제목 `API 키 설정`, 상태 `설정되지 않음`, 라벨 `OpenAI API 키`, 버튼 `API 키 저장` 및 `API 키 삭제`를 기대하도록 테스트를 수정한다. 저장 후 `설정됨`을 표시하면서 입력한 `sk-secret-value`가 렌더링되지 않는 기존 검사를 유지한다. 오류 상태 기대값도 한국어 문구로 바꾼다.

- [ ] **Step 2: 테스트가 영어 하드코딩 때문에 실패하는지 확인**

  Run: `npm test -- tests/unit/api-key-settings.test.tsx`
  Expected: 한국어 제목 또는 상태를 찾지 못해 FAIL

- [ ] **Step 3: 컴포넌트 문구를 최소 변경**

  `ApiKeySettings.tsx`의 제목, 상태, 검증 시각, 라벨, 버튼과 다섯 오류 메시지를 설계 문구로 교체한다. JSX 구조와 이벤트 처리 코드는 변경하지 않는다.

- [ ] **Step 4: 단위 테스트와 전체 검증 실행**

  Run: `npm test -- tests/unit/api-key-settings.test.tsx`
  Expected: 해당 테스트 파일 전체 PASS

  Run: `npm test`
  Expected: 전체 테스트 PASS

- [ ] **Step 5: 설정 화면 스크린샷 갱신 및 픽셀 확인**

  Run: `npx playwright test tests/visual/feature-docs.pw.ts --update-snapshots`
  Expected: `07-api-key-settings.png` 파일들이 한국어 카드 문구로 갱신됨

  실제 PNG를 열어 영어 UI 문구가 없고 레이아웃이 잘리지 않았는지 확인한다.

- [ ] **Step 6: 변경 범위 검토**

  Run: `git diff --check && git diff -- src/renderer/src/features/settings/ApiKeySettings.tsx tests/unit/api-key-settings.test.tsx docs/screenshots/07-api-key-settings.png docs/screenshots/after-linear/07-api-key-settings.png`
  Expected: 요청 범위 파일만 변경되고 공백 오류 없음
