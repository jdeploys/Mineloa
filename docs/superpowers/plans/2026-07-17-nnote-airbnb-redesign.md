# Nnote Airbnb-inspired Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nnote의 모든 Renderer 화면을 Airbnb-inspired 라이트/따뜻한 차콜 디자인과 명확한 정보 위계로 개편하면서 기존 녹음·처리·템플릿 동작과 사용자 추가 설정 도움말을 보존한다.

**Architecture:** 기존 Electron Main, Preload, IPC, 저장소와 provider adapter는 변경하지 않는다. Renderer에 의미 중심 공통 UI 계층, `system | light | dark` 테마 hook, 상단 AppShell을 추가하고 각 feature는 도메인 상태만 소유한 채 공통 UI를 조합한다. 시각 검증은 합성 component harness뿐 아니라 실제 `App` route와 실제 Electron 창까지 포함한다.

**Tech Stack:** Electron 43, React 19, TypeScript 7, electron-vite, Vitest, Testing Library, Playwright, `@fontsource-variable/inter@5.2.8`, getdesign Airbnb `DESIGN.md`

## Global Constraints

- Renderer 시각 체계와 정보 위계만 변경한다. Electron Main, Preload, IPC 계약과 SQLite 스키마는 변경하지 않는다.
- 기존 녹음, 복구, 처리, 가져오기·내보내기, template mutation 의미를 보존한다.
- 테마 값은 정확히 `system`, `light`, `dark`이며 기본값은 `system`이다.
- Light 핵심 토큰은 `#ffffff`, `#222222`, `#3f3f3f`, `#6a6a6a`, `#f7f7f7`, `#f2f2f2`, `#dddddd`, `#ebebeb`, `#ff385c`, `#e00b41`, `#ffd1da`다.
- 다크 테마는 순수 검정이 아닌 따뜻한 차콜을 사용한다.
- Airbnb 독점 폰트·로고·사진·브랜드 자산은 사용하지 않는다. 앱에 번들되는 Inter Variable만 추가한다.
- 최소 창 너비 640px에서 수평 스크롤이 없어야 하며 실제 1200×800 Electron viewport에서 페이지 상단과 핵심 행동이 보여야 한다.
- 기존 `docs/screenshots`와 `docs/screenshots/after-linear` 파일은 덮어쓰거나 삭제하지 않는다.
- 현재 사용자 미커밋 변경인 `CodexCliStatus.tsx`, `ProcessingProviderSettings.tsx`, `app.css`, `processing-provider-settings.test.tsx`, `processing-codex-unavailable.png`를 기준 상태로 보존하고 절대 revert하지 않는다.
- 각 task의 commit에는 그 task 파일만 명시적으로 stage한다. `git add .`를 사용하지 않는다.
- 시각 변경에는 바뀌어야 하는 결과와 가장 가까운 바뀌지 않아야 하는 기능의 paired regression test를 둔다.

---

## File Structure

### New design foundation

- `src/renderer/src/hooks/useThemePreference.ts`: 저장된 테마, system media query, root `data-theme` 동기화만 담당한다.
- `src/renderer/src/features/settings/AppearanceSettings.tsx`: 세 가지 테마 선택 UI만 담당한다.
- `src/renderer/src/styles/themes.css`: light/dark semantic token 정의만 담당한다.
- `src/renderer/src/styles/globals.css`: reset, typography, focus, 기본 form control만 담당한다.
- `tests/unit/theme-preference.test.tsx`: theme resolution, persistence, system 변경을 검증한다.
- `tests/unit/airbnb-design-source.test.ts`: 설치된 `DESIGN.md` 출처와 필수 token을 검증한다.

### New common UI

- `src/renderer/src/components/ui/Button.tsx`: native button props와 `primary | secondary | tertiary | danger` variant.
- `src/renderer/src/components/ui/SurfaceCard.tsx`: section/region 표면과 heading 연결.
- `src/renderer/src/components/ui/StatusBadge.tsx`: label과 semantic tone만 표현.
- `src/renderer/src/components/layout/AppShell.tsx`: 브랜드, 상단 내비게이션, import action, page content.
- `src/renderer/src/components/layout/PageHeader.tsx`: back action, eyebrow, title, description, trailing action.
- `src/renderer/src/components/layout/ActionBar.tsx`: primary/secondary/danger 행동 배치.
- `src/renderer/src/components/feedback/InlineNotice.tsx`: `info | privacy | warning | error | success` notice.
- `src/renderer/src/components/feedback/EmptyState.tsx`: 빈 목록 안내.
- `src/renderer/src/components/feedback/StatusIndicator.tsx`: provider availability dot + text.
- `src/renderer/src/components/help/FieldHelp.tsx`: control 바로 아래 한 문장 도움말.
- `src/renderer/src/components/help/PrivacyNotice.tsx`: 데이터 이동/로컬 처리 안내.
- `src/renderer/src/components/help/TroubleshootingDisclosure.tsx`: 오류일 때만 보이는 해결 절차.
- `tests/unit/common-ui.test.tsx`: variant, label association, 조건부 disclosure를 검증한다.

### Existing feature files to modify

- `src/renderer/src/App.tsx`: AppShell, route scroll/focus, AppearanceSettings 조립.
- `src/renderer/src/features/meetings/Dashboard.tsx`: topbar 제거, 새 회의 우선 위계.
- `src/renderer/src/features/recording/RecordingPanel.tsx`: 상태/metric/action hierarchy.
- `src/renderer/src/features/recording/RecoveryDialog.tsx`: 공통 dialog/card/action styling source.
- `src/renderer/src/features/meetings/MeetingDetail.tsx`: summary-first document hierarchy.
- `src/renderer/src/features/meetings/ProcessingStatus.tsx`: 공통 notice/action 사용.
- `src/renderer/src/features/meetings/SpeakerEditor.tsx`: card/form/action hierarchy.
- `src/renderer/src/features/meetings/Transcript.tsx`: responsive transcript layout.
- `src/renderer/src/features/templates/TemplateEditor.tsx`: master-detail, vertical section cards, single save CTA.
- `src/renderer/src/features/settings/ApiKeySettings.tsx`: 공통 card/help/privacy/danger hierarchy.
- `src/renderer/src/features/settings/ProcessingProviderSettings.tsx`: 기존 사용자 도움말을 공통 help component로 조립.
- `src/renderer/src/features/settings/CodexCliStatus.tsx`: 기존 문제 해결 문구를 조건부 disclosure로 조립.
- `src/renderer/src/features/settings/WhisperModelSettings.tsx`: local privacy/status/model card 조립.
- `src/renderer/src/styles/app.css`: feature layout만 남기고 global/common 규칙 제거.

### Verification and documentation files

- `tests/visual/harness/src.tsx`: 직접 feature를 반환하지 않고 fixture `DesktopApi`와 실제 `App`을 렌더링한다.
- `tests/visual/task10.visual.pw.ts`: 실제 route, viewport crop, light/dark snapshots.
- `tests/visual/processing-settings.visual.pw.ts`: 설정 help hierarchy와 compact overflow.
- `tests/visual/feature-docs.pw.ts`: `after-airbnb` 문서 스크린샷 생성.
- `tests/e2e/app.spec.ts`: 실제 Electron CSS, route top, theme, recording smoke.
- `tests/unit/before-screenshots.test.ts`: 기존 두 screenshot set의 checksum 보존 범위 확장.
- `docs/screenshots/after-airbnb/*.png`: 기능별 최종 결과.
- `docs/screenshots/README.md`: Before → Linear → Airbnb 비교 경로.

---

### Task 0: Preserve the existing Codex help work as a tested baseline

**Files:**
- Existing modified: `src/renderer/src/features/settings/CodexCliStatus.tsx`
- Existing modified: `src/renderer/src/features/settings/ProcessingProviderSettings.tsx`
- Existing modified: `src/renderer/src/styles/app.css`
- Existing modified: `tests/unit/processing-provider-settings.test.tsx`
- Existing modified: `tests/visual/snapshots/win32/processing-codex-unavailable.png`

**Interfaces:**
- Produces: committed baseline for four Codex failure mappings, cloud-processing disclosure, raw-path redaction and status refresh.
- Preserves: provider selection and `updateProcessingProviders` behavior.

- [ ] **Step 1: Review the pre-existing diff without modifying it**

Run:

```powershell
git diff -- src/renderer/src/features/settings/CodexCliStatus.tsx src/renderer/src/features/settings/ProcessingProviderSettings.tsx src/renderer/src/styles/app.css tests/unit/processing-provider-settings.test.tsx
git diff --numstat -- tests/visual/snapshots/win32/processing-codex-unavailable.png
```

Expected: source diff contains cloud-vs-local guidance, four actionable error mappings, a `다시 확인` action and raw availability-message suppression; exactly one Windows snapshot is changed.

- [ ] **Step 2: Run paired behavior and visual regression tests**

Run:

```powershell
npm test -- tests/unit/processing-provider-settings.test.tsx
npm run test:visual -- tests/visual/processing-settings.visual.pw.ts
```

Expected: all settings behavior cases PASS, including `refreshes Codex invalid-config status without changing the selected providers`; all Windows provider snapshots PASS.

- [ ] **Step 3: Inspect the changed Codex-unavailable pixels**

Open `tests/visual/snapshots/win32/processing-codex-unavailable.png` at original resolution. Confirm the troubleshooting steps and `다시 확인` button are visible, no raw local path is shown, and provider selects remain usable.

- [ ] **Step 4: Commit only the existing help baseline**

```powershell
git add src/renderer/src/features/settings/CodexCliStatus.tsx src/renderer/src/features/settings/ProcessingProviderSettings.tsx src/renderer/src/styles/app.css tests/unit/processing-provider-settings.test.tsx tests/visual/snapshots/win32/processing-codex-unavailable.png
git commit -m "🩹 fix: add actionable Codex CLI help"
```

---

### Task 1: Adopt Airbnb DESIGN.md and theme foundation

**Files:**
- Modify: `DESIGN.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/src/styles/tokens.css`
- Create: `src/renderer/src/styles/themes.css`
- Create: `src/renderer/src/styles/globals.css`
- Create: `src/renderer/src/hooks/useThemePreference.ts`
- Create: `src/renderer/src/features/settings/AppearanceSettings.tsx`
- Create: `tests/unit/airbnb-design-source.test.ts`
- Create: `tests/unit/theme-preference.test.tsx`

**Interfaces:**
- Produces: `ThemePreference = 'system' | 'light' | 'dark'`
- Produces: `ResolvedTheme = 'light' | 'dark'`
- Produces: `useThemePreference(): { preference; resolvedTheme; setPreference }`
- Produces: `<AppearanceSettings preference onChange />`

- [ ] **Step 1: Write failing source and theme tests**

```ts
// tests/unit/airbnb-design-source.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Airbnb design source', () => {
  it('keeps the installed Airbnb design source and core tokens', () => {
    const design = readFileSync('DESIGN.md', 'utf8')
    expect(design).toContain('name: Airbnb-design-analysis')
    expect(design).toContain('primary: "#ff385c"')
    expect(design).toContain('ink: "#222222"')
  })
})
```

```tsx
// tests/unit/theme-preference.test.tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveTheme, useThemePreference } from '../../src/renderer/src/hooks/useThemePreference'

describe('theme preference', () => {
  afterEach(() => { localStorage.clear(); delete document.documentElement.dataset.theme })

  it('resolves system while preserving manual light and dark choices', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('persists manual selection without disabling system mode', () => {
    const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    vi.stubGlobal('matchMedia', vi.fn(() => media))
    const { result } = renderHook(() => useThemePreference())
    expect(result.current.preference).toBe('system')
    act(() => result.current.setPreference('dark'))
    expect(localStorage.getItem('nnote.theme')).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
```

- [ ] **Step 2: Run tests and confirm the old Linear source and missing hook fail**

Run: `npm test -- tests/unit/airbnb-design-source.test.ts tests/unit/theme-preference.test.tsx`

Expected: FAIL because `DESIGN.md` is Linear-based and `useThemePreference.ts` does not exist.

- [ ] **Step 3: Install the approved design source and bundled Inter version**

Run:

```powershell
npx --yes getdesign@latest add airbnb --force
npm install --save-exact @fontsource-variable/inter@5.2.8
```

Expected: `DESIGN.md` begins with `name: Airbnb-design-analysis`; package and lockfile contain `@fontsource-variable/inter: 5.2.8`.

- [ ] **Step 4: Implement the theme hook and appearance control**

```ts
// src/renderer/src/hooks/useThemePreference.ts
import { useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'
const storageKey = 'nnote.theme'

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
}

function storedPreference(): ThemePreference {
  const stored = globalThis.localStorage?.getItem(storageKey)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

export function useThemePreference() {
  const [preference, setPreferenceState] = useState<ThemePreference>(storedPreference)
  const [systemDark, setSystemDark] = useState(() => globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
  const resolvedTheme = resolveTheme(preference, systemDark)

  useEffect(() => {
    const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => { document.documentElement.dataset.theme = resolvedTheme }, [resolvedTheme])

  function setPreference(next: ThemePreference) {
    setPreferenceState(next)
    if (next === 'system') localStorage.removeItem(storageKey)
    else localStorage.setItem(storageKey, next)
  }

  return { preference, resolvedTheme, setPreference }
}
```

```tsx
// src/renderer/src/features/settings/AppearanceSettings.tsx
import type { ThemePreference } from '../../hooks/useThemePreference'

export function AppearanceSettings({ preference, onChange }: {
  preference: ThemePreference
  onChange(value: ThemePreference): void
}) {
  return <section className="settings-section appearance-settings" aria-labelledby="appearance-title">
    <div><p className="eyebrow">APPEARANCE</p><h2 id="appearance-title">화면 테마</h2></div>
    <fieldset className="theme-options">
      <legend>테마 선택</legend>
      {([['system', '시스템 설정'], ['light', '라이트'], ['dark', '다크']] as const).map(([value, label]) =>
        <label key={value}><input type="radio" name="theme" value={value} checked={preference === value} onChange={() => onChange(value)} />{label}</label>)}
    </fieldset>
    <p className="field-help">시스템 설정은 Windows 또는 macOS의 화면 모드를 자동으로 따릅니다.</p>
  </section>
}
```

- [ ] **Step 5: Split semantic themes and global styles**

`tokens.css`에는 spacing, radius, type size만 남긴다. `themes.css`의 정확한 light root와 dark override는 다음 형태를 사용한다.

```css
:root, :root[data-theme="light"] {
  color-scheme: light;
  --canvas: #ffffff;
  --surface-1: #ffffff;
  --surface-2: #f7f7f7;
  --surface-3: #f2f2f2;
  --ink: #222222;
  --ink-muted: #3f3f3f;
  --ink-subtle: #6a6a6a;
  --hairline: #dddddd;
  --hairline-subtle: #ebebeb;
  --primary: #ff385c;
  --primary-active: #e00b41;
  --primary-disabled: #ffd1da;
  --danger: #c13515;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --canvas: #171513;
  --surface-1: #211f1c;
  --surface-2: #292622;
  --surface-3: #312d29;
  --ink: #fffaf5;
  --ink-muted: #e1d9d1;
  --ink-subtle: #aaa19a;
  --hairline: #4a4540;
  --hairline-subtle: #37332f;
  --primary: #ff5a74;
  --primary-active: #ff385c;
  --primary-disabled: #70414a;
  --danger: #ff9a85;
}
```

`main.tsx` import order를 다음처럼 고정한다.

```ts
import '@fontsource-variable/inter'
import './styles/tokens.css'
import './styles/themes.css'
import './styles/globals.css'
import './styles/app.css'
```

- [ ] **Step 6: Run theme tests, typecheck and commit**

Run: `npm test -- tests/unit/airbnb-design-source.test.ts tests/unit/theme-preference.test.tsx && npm run typecheck`

Expected: both test files PASS; both TypeScript projects exit 0.

Commit:

```powershell
git add DESIGN.md package.json package-lock.json src/renderer/src/main.tsx src/renderer/src/styles/tokens.css src/renderer/src/styles/themes.css src/renderer/src/styles/globals.css src/renderer/src/hooks/useThemePreference.ts src/renderer/src/features/settings/AppearanceSettings.tsx tests/unit/airbnb-design-source.test.ts tests/unit/theme-preference.test.tsx
git commit -m "🎨 feat: add Airbnb-inspired theme foundation"
```

---

### Task 2: Build the common UI directory

**Files:**
- Create: all common UI files listed in **New common UI**
- Create: `tests/unit/common-ui.test.tsx`
- Modify: `src/renderer/src/styles/globals.css`
- Modify: `src/renderer/src/styles/app.css`

**Interfaces:**
- Produces: `ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>` with `variant`
- Produces: `SurfaceCard({ as, labelledBy, className, children })`
- Produces: `StatusBadge({ label, tone })`
- Produces: layout and help primitives consumed by Tasks 3–7.

- [ ] **Step 1: Write failing semantic component tests**

```tsx
// tests/unit/common-ui.test.tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from '../../src/renderer/src/components/ui/Button'
import { InlineNotice } from '../../src/renderer/src/components/feedback/InlineNotice'
import { TroubleshootingDisclosure } from '../../src/renderer/src/components/help/TroubleshootingDisclosure'

describe('common UI semantics', () => {
  it('exposes visual variants without changing native button behavior', () => {
    render(<Button variant="danger" disabled>삭제</Button>)
    expect(screen.getByRole('button', { name: '삭제' })).toBeDisabled()
    expect(screen.getByRole('button')).toHaveAttribute('data-variant', 'danger')
  })

  it('labels privacy notices and only renders troubleshooting when supplied', () => {
    const { rerender } = render(<InlineNotice tone="privacy" title="클라우드 처리">전사문이 전송됩니다.</InlineNotice>)
    expect(screen.getByRole('note', { name: '클라우드 처리' })).toBeVisible()
    rerender(<TroubleshootingDisclosure title="문제 해결" steps={null} />)
    expect(screen.queryByRole('region', { name: '문제 해결' })).not.toBeInTheDocument()
    rerender(<TroubleshootingDisclosure title="문제 해결" steps={['codex login', '다시 확인']} />)
    expect(screen.getByRole('region', { name: '문제 해결' })).toHaveTextContent('codex login')
  })
})
```

- [ ] **Step 2: Run the test and confirm missing modules**

Run: `npm test -- tests/unit/common-ui.test.tsx`

Expected: FAIL with module resolution errors for `components/ui`, `feedback`, and `help`.

- [ ] **Step 3: Implement focused primitives**

Use native elements and forward all native props. The core shapes are:

```tsx
// components/ui/Button.tsx
import type { ButtonHTMLAttributes } from 'react'
export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger'
export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={`ui-button ${className}`.trim()} data-variant={variant} {...props} />
}
```

```tsx
// components/feedback/InlineNotice.tsx
import type { ReactNode } from 'react'
export function InlineNotice({ tone = 'info', title, children }: { tone?: 'info' | 'privacy' | 'warning' | 'error' | 'success'; title: string; children: ReactNode }) {
  return <aside className="inline-notice" data-tone={tone} role={tone === 'error' ? 'alert' : 'note'} aria-label={title}><strong>{title}</strong><div>{children}</div></aside>
}
```

```tsx
// components/help/TroubleshootingDisclosure.tsx
import type { ReactNode } from 'react'
export function TroubleshootingDisclosure({ title, steps, action }: { title: string; steps: readonly ReactNode[] | null; action?: ReactNode }) {
  if (steps === null) return null
  return <section className="troubleshooting" aria-label={title}><strong>{title}</strong><ol>{steps.map((step, index) => <li key={index}>{step}</li>)}</ol>{action}</section>
}
```

Add the remaining primitives with these exact public shapes:

```tsx
// components/ui/SurfaceCard.tsx
import type { ReactNode } from 'react'
export function SurfaceCard({ labelledBy, className = '', children }: { labelledBy?: string; className?: string; children: ReactNode }) {
  return <section className={`surface-card ${className}`.trim()} aria-labelledby={labelledBy}>{children}</section>
}

// components/ui/StatusBadge.tsx
export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'active' }) {
  return <span className="status-badge" data-tone={tone}>{label}</span>
}

// components/layout/ActionBar.tsx
import type { ReactNode } from 'react'
export function ActionBar({ children, danger }: { children: ReactNode; danger?: ReactNode }) {
  return <div className="action-bar"><div>{children}</div>{danger === undefined ? null : <div className="action-bar-danger">{danger}</div>}</div>
}

// components/feedback/EmptyState.tsx
export function EmptyState({ title, description }: { title: string; description?: string }) {
  return <div className="empty-state"><strong>{title}</strong>{description === undefined ? null : <p>{description}</p>}</div>
}

// components/feedback/StatusIndicator.tsx
import type { ReactNode } from 'react'
export function StatusIndicator({ available, children }: { available: boolean; children: ReactNode }) {
  return <div className="status-indicator" data-available={available}><span aria-hidden="true" />{children}</div>
}

// components/help/FieldHelp.tsx
import type { ReactNode } from 'react'
export function FieldHelp({ children }: { children: ReactNode }) { return <p className="field-help">{children}</p> }

// components/help/PrivacyNotice.tsx
import type { ReactNode } from 'react'
import { InlineNotice } from '../feedback/InlineNotice'
export function PrivacyNotice({ title, children }: { title: string; children: ReactNode }) {
  return <InlineNotice tone="privacy" title={title}>{children}</InlineNotice>
}
```

```tsx
// components/layout/AppShell.tsx
import type { ReactNode } from 'react'
type PrimaryScreen = 'all' | 'templates' | 'settings'

export function AppShell({ active, onNavigate, onImport, children }: {
  active: PrimaryScreen
  onNavigate(destination: PrimaryScreen): void
  onImport?(): void
  children: ReactNode
}) {
  const entries = [['all', '전체 기록'], ['templates', '요약 템플릿'], ['settings', '설정']] as const
  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" type="button" onClick={() => onNavigate('all')} aria-label="Nnote 홈">Nnote</button>
      <nav className="app-nav" aria-label="주요 메뉴">
        {entries.map(([value, label]) => <button key={value} type="button" aria-current={active === value ? 'page' : undefined} data-focus-key={value === 'all' ? undefined : `nav-${value}`} onClick={() => onNavigate(value)}>{label}</button>)}
        {onImport === undefined ? null : <button type="button" className="nav-import" onClick={onImport}>.nnote 가져오기</button>}
      </nav>
    </header>
    {children}
  </div>
}
```

```tsx
// components/layout/PageHeader.tsx
import { forwardRef, type ReactNode } from 'react'

export const PageHeader = forwardRef<HTMLHeadingElement, {
  eyebrow?: string
  title: string
  description?: string
  backLabel?: string
  onBack?(): void
  trailing?: ReactNode
}>(function PageHeader({ eyebrow, title, description, backLabel, onBack, trailing }, ref) {
  return <header className="page-header">
    {backLabel === undefined || onBack === undefined ? null : <button type="button" className="back-button" onClick={onBack}>← {backLabel}</button>}
    <div className="page-header-row"><div>{eyebrow === undefined ? null : <p className="eyebrow">{eyebrow}</p>}<h1 ref={ref} tabIndex={-1}>{title}</h1>{description === undefined ? null : <p>{description}</p>}</div>{trailing}</div>
  </header>
})
```

These two components contain layout and navigation markup only and import no feature modules.

- [ ] **Step 4: Add common component styles**

Put button/form/focus defaults in `globals.css`; put `.surface-card`, `.page-header`, `.action-bar`, `.inline-notice`, `.status-indicator`, `.field-help`, `.troubleshooting` in the appropriate common section of `app.css`. Primary controls use `--primary`, one 48px control height, 8px radius; cards use 14px radius and `--hairline`.

- [ ] **Step 5: Run focused tests, lint and commit**

Run: `npm test -- tests/unit/common-ui.test.tsx && npm run lint && npm run typecheck`

Expected: PASS and zero lint/type errors.

Commit:

```powershell
git add src/renderer/src/components src/renderer/src/styles/globals.css src/renderer/src/styles/app.css tests/unit/common-ui.test.tsx
git commit -m "🧱 feat: add semantic common UI components"
```

---

### Task 3: Move navigation into AppShell and fix route top visibility

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/features/meetings/Dashboard.tsx`
- Modify: `tests/unit/app-routing.test.tsx`
- Modify: `src/renderer/src/styles/app.css`

**Interfaces:**
- Consumes: `AppShell`, `PageHeader`, `AppearanceSettings`, `useThemePreference`.
- Preserves: hidden dashboard subtree so an active `RecordingPanel` is not remounted across navigation.

- [ ] **Step 1: Add paired route regression tests**

Add to `tests/unit/app-routing.test.tsx`:

```tsx
it('moves every secondary route to the visible page top while keeping heading focus', async () => {
  const user = userEvent.setup()
  const scrollTo = vi.fn()
  vi.stubGlobal('scrollTo', scrollTo)
  render(<App desktopApi={api()} recordingController={{ start: vi.fn(), stop: vi.fn(), discard: vi.fn() }} />)
  await user.click(await screen.findByRole('button', { name: '설정' }))
  expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' })
  expect(screen.getByRole('heading', { name: '설정' })).toHaveFocus()
})

it('keeps one recording instance alive when the shared top navigation changes routes', async () => {
  const user = userEvent.setup()
  const controller = { start: vi.fn(async () => undefined), stop: vi.fn(), discard: vi.fn() }
  render(<App desktopApi={api()} recordingController={controller} />)
  await user.click(await screen.findByRole('button', { name: '녹음 시작' }))
  await user.click(screen.getByRole('button', { name: '설정' }))
  await user.click(screen.getByRole('button', { name: '전체 기록' }))
  expect(screen.getByText('녹음 중')).toBeVisible()
  expect(controller.start).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run route tests and observe the missing scroll reset**

Run: `npm test -- tests/unit/app-routing.test.tsx`

Expected: new route-top test FAILS because current code calls `focus()` without `preventScroll` or `scrollTo`.

- [ ] **Step 3: Assemble AppShell once around all normal routes**

Move the header out of `Dashboard`. In `App.tsx`, call the theme hook and wrap dashboard/detail/settings/templates in one shell:

```tsx
const { preference, setPreference } = useThemePreference()
const activeNavigation = screen === 'templates' || screen === 'settings' ? screen : 'all'

return <AppShell active={activeNavigation} onNavigate={navigate} onImport={() => void importMeeting()}>
  <div hidden={screen !== 'all'}>
    <Dashboard meetings={meetings} recordingControls={recordingControls} templates={desktopApi.templates} onOpenMeeting={(id) => void openMeeting(id)} onNavigate={navigate} />
  </div>
  {screen === 'settings' && <main className="page-container settings-page">
    <PageHeader ref={routeHeading} eyebrow="SETTINGS" title="설정" description="Nnote가 기록과 AI 처리를 사용하는 방식을 관리합니다." />
    <AppearanceSettings preference={preference} onChange={setPreference} />
    <ApiKeySettings settings={desktopApi.settings} />
    <ProcessingProviderSettings settings={desktopApi.settings} />
  </main>}
  {screen === 'detail' && document !== null && <MeetingDetail
    document={document}
    headingRef={routeHeading}
    onBack={backToAll}
    onRenameSpeaker={desktopApi.meetings.renameSpeaker}
    processing={desktopApi.processing}
    initialProcessingStatus={processingStatus ?? undefined}
    archive={desktopApi.archive}
    onRefresh={refreshOpenMeeting}
  />}
  {screen === 'templates' && <main className="page-container template-page">
    <PageHeader ref={routeHeading} eyebrow="TEMPLATES" title="요약 템플릿" description="회의 종류에 맞는 요약 구조와 지시문을 관리합니다." />
    <TemplateEditor templates={desktopApi.templates} />
  </main>}
</AppShell>
```

The route effect must use:

```ts
if (screen !== 'all') {
  globalThis.scrollTo?.({ top: 0, left: 0, behavior: 'auto' })
  routeHeading.current?.focus({ preventScroll: true })
  return
}
```

- [ ] **Step 4: Keep current-route semantics in the top navigation**

`AppShell` uses `aria-current="page"` on the active navigation button, preserves `data-focus-key="nav-templates"` and `data-focus-key="nav-settings"`, and keeps `.nnote 가져오기` a secondary action. `Dashboard` now returns only its `<main>` content.

- [ ] **Step 5: Run paired route/recording tests and commit**

Run: `npm test -- tests/unit/app-routing.test.tsx tests/unit/dashboard.test.tsx tests/unit/recording-panel.test.tsx && npm run typecheck`

Expected: route top/focus and existing recording identity tests PASS.

Commit:

```powershell
git add src/renderer/src/App.tsx src/renderer/src/features/meetings/Dashboard.tsx src/renderer/src/styles/app.css tests/unit/app-routing.test.tsx
git commit -m "🧭 feat: add shared top navigation and stable route focus"
```

---

### Task 4: Redesign dashboard, recording and recovery hierarchy

**Files:**
- Modify: `src/renderer/src/features/meetings/Dashboard.tsx`
- Modify: `src/renderer/src/features/recording/RecordingPanel.tsx`
- Modify: `src/renderer/src/features/recording/RecoveryDialog.tsx`
- Modify: `src/renderer/src/styles/app.css`
- Modify: `tests/unit/dashboard.test.tsx`
- Modify: `tests/unit/recording-panel.test.tsx`
- Modify: `tests/unit/recovery-dialog.test.tsx`

**Interfaces:**
- Consumes: `Button`, `SurfaceCard`, `StatusBadge`, `ActionBar`, `InlineNotice`, `EmptyState`.
- Preserves: `RecordingPanelControls` and all recovery API calls.

- [ ] **Step 1: Add visible-outcome and preserved-behavior tests**

```tsx
it('places new meeting before the recent library and exposes one primary start action', async () => {
  render(<Dashboard meetings={[]} recordingControls={{ start: vi.fn(), stop: vi.fn(), discard: vi.fn() }} onOpenMeeting={vi.fn()} onNavigate={vi.fn()} />)
  const main = await screen.findByRole('main')
  const headings = within(main).getAllByRole('heading').map((heading) => heading.textContent)
  expect(headings.slice(0, 2)).toEqual(['새 회의', '최근 기록'])
  expect(screen.getByRole('button', { name: '녹음 시작' })).toHaveAttribute('data-variant', 'primary')
})

it('keeps pause, stop and explicit discard confirmation semantics', async () => {
  const user = userEvent.setup()
  let listener: ((snapshot: RecordingSnapshot) => void) | undefined
  const controls = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    discard: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    subscribe: vi.fn((next: (snapshot: RecordingSnapshot) => void) => { listener = next; return () => undefined }),
  }
  render(<RecordingPanel controls={controls} onNavigate={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: '녹음 시작' }))
  act(() => listener?.({ phase: 'recording', meetingId: 'm1', durationMs: 1_000, totalBytes: 1024, warn: false, activePartIndex: 0, partCount: 1, microphone: 'active', localSave: 'saving' }))
  await user.click(screen.getByRole('button', { name: '일시정지' }))
  expect(controls.pause).toHaveBeenCalledTimes(1)
  expect(controls.stop).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '폐기' }))
  expect(controls.discard).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '녹음 폐기 확인' }))
  expect(controls.discard).toHaveBeenCalledTimes(1)
})
```

Import `act` and `RecordingSnapshot` in the recording test. Keep all existing stop-failure, discard-failure and capture-failure tests alongside this paired regression.

- [ ] **Step 2: Run focused tests and confirm hierarchy assertions fail**

Run: `npm test -- tests/unit/dashboard.test.tsx tests/unit/recording-panel.test.tsx tests/unit/recovery-dialog.test.tsx`

Expected: the new `data-variant="primary"` and common card assertions FAIL; existing behavior tests remain green.

- [ ] **Step 3: Recompose dashboard and recording controls**

Use this structure without changing controller calls:

```tsx
function statusTone(status: PublicMeeting['status']): 'success' | 'warning' | 'danger' | 'active' {
  if (status === 'completed' || status === 'recorded') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'recording') return 'active'
  return 'warning'
}

<main className="dashboard page-container">
  <SurfaceCard className="new-meeting-card" labelledBy="new-meeting-heading">
    <header className="card-heading"><p className="eyebrow">NEW MEETING</p><h1 id="new-meeting-heading">새 회의</h1><p>노트북 마이크로 녹음하고 이 기기에 안전하게 저장합니다.</p></header>
    <RecordingPanel controls={recordingControls} templates={templates} settingsFocusKey="recording-settings" onNavigate={() => onNavigate('settings', 'recording-settings')} />
  </SurfaceCard>
  <SurfaceCard className="recent-card" labelledBy="recent-heading">
    <header className="section-heading"><div><p className="eyebrow">LIBRARY</p><h2 id="recent-heading">최근 기록</h2></div><span className="meeting-count">{meetings.length}</span></header>
    {meetings.length === 0 ? <EmptyState title="최근 기록이 없습니다." description="첫 회의를 녹음하면 여기에 안전하게 모입니다." /> : <ul className="meeting-list">{meetings.map((meeting) => <li key={meeting.id}><button className="meeting-row" data-focus-key={`meeting-${meeting.id}`} type="button" onClick={() => onOpenMeeting(meeting.id)}><span className="meeting-copy"><strong>{meeting.title}</strong><span>{formatDate(meeting.createdAt)} · {formatDuration(meeting.durationMs)}</span></span><StatusBadge label={meeting.status} tone={statusTone(meeting.status)} /></button></li>)}</ul>}
  </SurfaceCard>
</main>
```

Idle recording options go in `.recording-options`; recording state starts with a live status row and large elapsed time, followed by three metric tiles and an `ActionBar`. Start and stop are primary, pause is secondary, settings is tertiary, discard is danger and spatially separated.

- [ ] **Step 4: Replace inline recovery styles with common rendering sources**

Remove `destructiveStyle` and all inline style props from `RecoveryDialog.tsx`. Use `<Button variant="danger">`, `.dialog-scrim`, `.dialog-panel`, `.recovery-item`, and nested `ActionBar`. Keep `role="dialog"`, `role="alertdialog"`, cancel, apply, and discard API paths unchanged.

- [ ] **Step 5: Run tests, inspect the diff for behavior leakage and commit**

Run: `npm test -- tests/unit/dashboard.test.tsx tests/unit/recording-panel.test.tsx tests/unit/recovery-dialog.test.tsx tests/unit/app-routing.test.tsx && npm run lint`

Expected: all focused suites PASS; diff contains no changes to `mediaRecorderController.ts` or shared contracts.

Commit:

```powershell
git add src/renderer/src/features/meetings/Dashboard.tsx src/renderer/src/features/recording/RecordingPanel.tsx src/renderer/src/features/recording/RecoveryDialog.tsx src/renderer/src/styles/app.css tests/unit/dashboard.test.tsx tests/unit/recording-panel.test.tsx tests/unit/recovery-dialog.test.tsx
git commit -m "🎨 feat: redesign meeting capture workspace"
```

---

### Task 5: Redesign meeting detail as a readable document

**Files:**
- Modify: `src/renderer/src/features/meetings/MeetingDetail.tsx`
- Modify: `src/renderer/src/features/meetings/ProcessingStatus.tsx`
- Modify: `src/renderer/src/features/meetings/SpeakerEditor.tsx`
- Modify: `src/renderer/src/features/meetings/Transcript.tsx`
- Modify: `src/renderer/src/styles/app.css`
- Modify: `tests/unit/meeting-detail.test.tsx`
- Modify: `tests/unit/processing-status.test.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `SurfaceCard`, `StatusBadge`, `ActionBar`, `InlineNotice`.
- Preserves: processing, retry, rename, audio and archive callback signatures.

- [ ] **Step 1: Add paired hierarchy/action tests**

```tsx
it('renders meeting status and processing actions before summary content', () => {
  render(<MeetingDetail document={documentFixture()} onBack={vi.fn()} onRenameSpeaker={vi.fn()} />)
  const main = screen.getByRole('main')
  const text = main.textContent ?? ''
  expect(text.indexOf('AI 처리 상태')).toBeLessThan(text.indexOf('핵심 요약'))
  expect(screen.getByText('completed')).toHaveAttribute('data-tone', 'success')
})

it('keeps retry, speaker rename and both export actions reachable', async () => {
  const user = userEvent.setup()
  const source = documentFixture()
  const rename = vi.fn(async (_meetingId: string, _speakerId: string, displayName: string) => ({ ...source.speakers[0]!, displayName }))
  const processing = { getStatus: vi.fn(), process: vi.fn(), retry: vi.fn(async () => ({ meetingId: 'meeting-1', state: 'completed' as const, failedStage: null, retryable: false, audioRequired: false, error: null })), onProgress: vi.fn(() => () => undefined) }
  const archive = { exportMeeting: vi.fn(async () => ({ status: 'success' as const, includedAudio: true, audioCoverage: 'all-parts' as const })), exportMarkdown: vi.fn(async () => ({ status: 'success' as const })), importMeeting: vi.fn() }
  render(<MeetingDetail document={source} initialProcessingStatus={{ meetingId: 'meeting-1', state: 'failed', failedStage: 'summarizing', retryable: true, audioRequired: false, error: { code: 'OPENAI_NETWORK', message: 'retry' } }} processing={processing} archive={archive} onRefresh={vi.fn()} onBack={vi.fn()} onRenameSpeaker={rename} />)
  await user.click(screen.getByRole('button', { name: '요약 다시 시도' }))
  await user.clear(screen.getByLabelText('화자 B 이름'))
  await user.type(screen.getByLabelText('화자 B 이름'), '민지')
  await user.click(screen.getByRole('button', { name: '화자 B 이름 저장' }))
  await user.click(screen.getByRole('button', { name: '.nnote 내보내기' }))
  await user.click(screen.getByRole('button', { name: 'Markdown 내보내기' }))
  expect(processing.retry).toHaveBeenCalledTimes(1)
  expect(rename).toHaveBeenCalledTimes(1)
  expect(archive.exportMeeting).toHaveBeenCalledTimes(1)
  expect(archive.exportMarkdown).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run detail tests and confirm common hierarchy markers fail**

Run: `npm test -- tests/unit/meeting-detail.test.tsx tests/unit/processing-status.test.tsx`

Expected: the `data-tone` and new section order assertion FAIL before implementation.

- [ ] **Step 3: Recompose the document header and content flow**

Use `PageHeader` for back/title/date/status, then a `.meeting-overview` SurfaceCard containing audio, `ProcessingStatus`, and the two export actions. Render template summary sections next, then actions, speakers, transcript, and finally a collapsed/secondary Markdown preview. Keep `orderedSections` semantics and speaker-id replacement unchanged.

```tsx
function meetingStatusTone(status: MeetingDocument['meeting']['status']): 'success' | 'warning' | 'danger' | 'active' {
  if (status === 'completed' || status === 'recorded') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'recording') return 'active'
  return 'warning'
}

<main className="page-container meeting-page">
  <PageHeader ref={headingRef} backLabel="전체 기록" onBack={onBack} title={document.meeting.title} description={formattedMeta} trailing={<StatusBadge label={document.meeting.status} tone={meetingStatusTone(document.meeting.status)} />} />
  <SurfaceCard className="meeting-overview" labelledBy="meeting-audio-title">
    <h2 id="meeting-audio-title">오디오 및 처리</h2>
    {audioParts.length === 0 ? <p className="muted">보존된 원본 오디오가 없습니다.</p> : audioParts.map((part) => <div className="audio-part" key={part.partIndex}><span>오디오 파트 {part.partIndex + 1}</span><audio aria-label={audioParts.length === 1 ? '회의 오디오' : `회의 오디오 파트 ${part.partIndex + 1}`} controls preload="metadata" src={part.url} /></div>)}
    {processing === undefined || initialProcessingStatus === undefined ? null : <ProcessingStatus meetingId={document.meeting.id} processing={processing} initialStatus={initialProcessingStatus} onStatusChange={(status) => { if (status.state === 'completed' || status.state === 'failed' || status.state === 'cleanup_failed') void onRefresh?.() }} />}
    {archive === undefined ? null : <ActionBar><Button onClick={() => void exportDocument('nnote')}>.nnote 내보내기</Button><Button variant="tertiary" onClick={() => void exportDocument('markdown')}>Markdown 내보내기</Button></ActionBar>}
  </SurfaceCard>
  <article className="meeting-document" aria-label="회의 문서">
    {orderedSections.map((section) => <section className="document-section" key={section.id}><h2>{section.title}</h2>{section.kind === 'action_items' ? (document.actionItems.length === 0 ? <p className="muted">등록된 할 일이 없습니다.</p> : <ul className="action-list">{document.actionItems.map((item) => <li key={item.id}><span>{item.content}</span><small>담당: {item.assigneeSpeakerId === null ? '미정' : names.get(item.assigneeSpeakerId) ?? item.assigneeSpeakerId}</small></li>)}</ul>) : sectionBody(section, speakers)}</section>)}
    <section className="document-section"><h2>화자 이름</h2><SpeakerEditor speakers={speakers} onRename={rename} /></section>
    <section className="document-section"><h2>전체 전사문</h2><Transcript segments={document.transcript} speakers={speakers} /></section>
    <details className="document-section markdown-preview"><summary>Markdown 미리보기</summary><pre className="markdown-code" data-testid="markdown-preview">{markdown(document, speakers)}</pre></details>
  </article>
</main>
```

- [ ] **Step 4: Apply responsive speaker/transcript sources**

Keep transcript markup as `<ol>` and each segment as `<li>`. At compact width switch `.transcript-row` from `130px 1fr` to one column. Speaker edit remains a label/input/button group; the button uses primary variant only for the explicit save action.

- [ ] **Step 5: Run focused and archive tests, then commit**

Run: `npm test -- tests/unit/meeting-detail.test.tsx tests/unit/processing-status.test.tsx tests/unit/markdown-export.test.ts tests/integration/archive-roundtrip.test.ts && npm run typecheck`

Expected: hierarchy and all preserved action tests PASS.

Commit:

```powershell
git add src/renderer/src/features/meetings/MeetingDetail.tsx src/renderer/src/features/meetings/ProcessingStatus.tsx src/renderer/src/features/meetings/SpeakerEditor.tsx src/renderer/src/features/meetings/Transcript.tsx src/renderer/src/styles/app.css tests/unit/meeting-detail.test.tsx tests/unit/processing-status.test.tsx
git commit -m "🎨 feat: restructure meeting document hierarchy"
```

---

### Task 6: Rebuild the template editor as master-detail with one save action

**Files:**
- Modify: `src/renderer/src/features/templates/TemplateEditor.tsx`
- Modify: `src/renderer/src/styles/app.css`
- Modify: `tests/unit/template-editor.test.tsx`
- Modify: `tests/integration/template-editor-persistence.test.tsx`

**Interfaces:**
- Consumes: `Button`, `SurfaceCard`, `ActionBar`, `InlineNotice`, `FieldHelp`.
- Preserves: `TemplatesApi.create`, `update`, `reorderSections`, `delete` signatures and in-use error translation.
- Changes only presentation of save: name and current sections are submitted in one `api.update(selected.id, { name, sections })` call.

- [ ] **Step 1: Add paired save/locked-template tests**

```tsx
it('saves the editable template name and sections through one primary action', async () => {
  const user = userEvent.setup()
  const editableTemplate = { ...defaultTemplate, id: 'custom', name: '사용자', isDefault: false as const }
  const api = {
    list: vi.fn(async () => [editableTemplate]),
    create: vi.fn(),
    update: vi.fn(async (_id, input) => ({ ...editableTemplate, name: input.name ?? editableTemplate.name, sections: input.sections ?? editableTemplate.sections })),
    reorderSections: vi.fn(),
    delete: vi.fn(),
  } satisfies TemplatesApi
  render(<TemplateEditor templates={api} />)
  await user.clear(await screen.findByLabelText('템플릿 이름'))
  await user.type(screen.getByLabelText('템플릿 이름'), '고객 인터뷰')
  await user.clear(screen.getByLabelText('섹션 1 지시문'))
  await user.type(screen.getByLabelText('섹션 1 지시문'), '핵심 니즈를 요약하세요.')
  await user.click(screen.getByRole('button', { name: '템플릿 저장' }))
  expect(api.update).toHaveBeenCalledTimes(1)
  expect(api.update).toHaveBeenCalledWith(editableTemplate.id, expect.objectContaining({ name: '고객 인터뷰', sections: [expect.objectContaining({ prompt: '핵심 니즈를 요약하세요.' })] }))
})

it('keeps the default template read-only and free of save or delete actions', async () => {
  const api = { list: vi.fn(async () => [defaultTemplate]), create: vi.fn(), update: vi.fn(), reorderSections: vi.fn(), delete: vi.fn() } satisfies TemplatesApi
  render(<TemplateEditor templates={api} />)
  expect(await screen.findByText('기본 템플릿은 수정하거나 삭제할 수 없습니다.')).toBeVisible()
  expect(screen.queryByRole('button', { name: '템플릿 저장' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '템플릿 삭제' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests and confirm the single-save test fails**

Run: `npm test -- tests/unit/template-editor.test.tsx tests/integration/template-editor-persistence.test.tsx`

Expected: FAIL because current UI exposes `이름 저장` and `섹션 저장` separately.

- [ ] **Step 3: Implement one save path and vertical section cards**

Replace `saveName` and `saveSections` with:

```ts
async function saveTemplate() {
  if (!selected || selected.isDefault) return
  try {
    const updated = await api.update(selected.id, { name, sections })
    setItems((current) => current.map((item) => item.id === updated.id ? updated : item))
    setError(null)
  } catch (caught) {
    setError(templateMutationError(caught, '템플릿을 저장하지 못했습니다.'))
  }
}
```

Render `.template-layout` as a 240px list plus fluid editor. Each `.template-section-card` is vertical: heading/action row, title and kind row, full-width prompt, move/remove actions. Bottom `ActionBar` contains `섹션 추가` secondary and `템플릿 저장` primary. Put `템플릿 삭제` alone in a `.danger-zone` with explicit label.

- [ ] **Step 4: Add compact list-to-editor layout without new routing**

At `<744px`, stack the list and editor, keep the selected template button marked with `aria-current="true"`, and ensure section buttons wrap. Do not add a new Screen enum or IPC state.

- [ ] **Step 5: Run template suites and commit**

Run: `npm test -- tests/unit/template-editor.test.tsx tests/integration/template-editor-persistence.test.tsx tests/unit/template-service.test.ts tests/unit/template-ipc.test.ts && npm run lint`

Expected: single-save, read-only default, reorder, create, delete, persistence and in-use suites PASS.

Commit:

```powershell
git add src/renderer/src/features/templates/TemplateEditor.tsx src/renderer/src/styles/app.css tests/unit/template-editor.test.tsx tests/integration/template-editor-persistence.test.tsx
git commit -m "🎨 feat: redesign summary template editor"
```

---

### Task 7: Organize settings and preserve the user-authored help flow

**Files:**
- Modify: `src/renderer/src/features/settings/ApiKeySettings.tsx`
- Modify: `src/renderer/src/features/settings/ProcessingProviderSettings.tsx`
- Modify: `src/renderer/src/features/settings/CodexCliStatus.tsx`
- Modify: `src/renderer/src/features/settings/WhisperModelSettings.tsx`
- Modify: `src/renderer/src/styles/app.css`
- Modify: `tests/unit/api-key-settings.test.tsx`
- Modify: `tests/unit/processing-provider-settings.test.tsx`

**Interfaces:**
- Consumes: `SurfaceCard`, `StatusIndicator`, `FieldHelp`, `PrivacyNotice`, `TroubleshootingDisclosure`, `ActionBar`, `Button`.
- Preserves: all current user-authored Codex error code mappings, raw-path redaction, refresh callback and provider selection.

- [ ] **Step 1: Reconfirm the preserved help baseline before reorganizing it**

Run:

```powershell
npm test -- tests/unit/processing-provider-settings.test.tsx tests/unit/api-key-settings.test.tsx
```

Expected: current tests for cloud labeling, all four Codex errors, refresh without provider changes, available-state help absence and raw path redaction PASS. These assertions are the protected behavior while markup is reorganized.

- [ ] **Step 2: Add hierarchy assertions around the existing help behavior**

```tsx
it('shows concise field help, a cloud privacy notice and failure-only troubleshooting in that order', async () => {
  const invalid = descriptors.map((descriptor) => descriptor.id === 'codex_cli'
    ? { ...descriptor, availability: { available: false, code: 'CODEX_CONFIG_INVALID', message: null } }
    : descriptor)
  render(<ProcessingProviderSettingsView settings={settingsApi({ listProcessingProviderDescriptors: vi.fn(async () => invalid) })} />)
  await expand()
  await userEvent.setup().selectOptions(screen.getByLabelText('요약 방식'), 'codex_cli')
  const section = screen.getByRole('region', { name: 'Codex CLI 상태' })
  const text = section.textContent ?? ''
  expect(text.indexOf('전사문이 Codex 계정으로 전송됩니다.')).toBeLessThan(text.indexOf('Codex CLI 문제 해결'))
  expect(screen.getByRole('note', { name: '클라우드 처리' })).toBeVisible()
})

it('keeps provider refresh independent from saving provider choices', async () => {
  const invalid = descriptors.map((descriptor) => descriptor.id === 'codex_cli'
    ? { ...descriptor, availability: { available: false, code: 'CODEX_CONFIG_INVALID', message: null } }
    : descriptor)
  const listDescriptors = vi.fn().mockResolvedValueOnce(descriptors).mockResolvedValueOnce(invalid).mockResolvedValue(descriptors)
  const api = settingsApi({ listProcessingProviderDescriptors: listDescriptors })
  render(<ProcessingProviderSettingsView settings={api} />)
  await expand()
  await userEvent.setup().selectOptions(screen.getByLabelText('요약 방식'), 'codex_cli')
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Codex CLI 상태 다시 확인' }))
  expect(api.updateProcessingProviders).not.toHaveBeenCalled()
  expect(screen.getByLabelText('요약 방식')).toHaveValue('codex_cli')
})
```

- [ ] **Step 3: Run settings tests and confirm common help roles fail**

Run: `npm test -- tests/unit/processing-provider-settings.test.tsx tests/unit/api-key-settings.test.tsx`

Expected: new `role="note"`/hierarchy assertion FAIL; all pre-existing user tests remain PASS.

- [ ] **Step 4: Recompose API key, provider, Whisper and Codex sections**

Apply the four-level help hierarchy exactly:

```tsx
<FieldHelp>변경 사항은 앞으로 시작하거나 다시 시도하는 처리에만 적용되며, 기존 결과는 다시 작성하지 않습니다.</FieldHelp>
<PrivacyNotice title="클라우드 처리">전사문이 Codex 계정으로 전송됩니다.<br />로컬 추론이 아닌 클라우드 처리입니다.</PrivacyNotice>
<StatusIndicator available={descriptor.availability.available}>{statusText}</StatusIndicator>
<TroubleshootingDisclosure title="Codex CLI 문제 해결" steps={steps} action={<Button onClick={() => void onAvailabilityChanged()}>다시 확인</Button>} />
```

For available Codex, pass `steps={null}` and do not render the refresh action. Keep `Nnote는 전역 Codex 설정이나 로그인 정보를 변경하지 않습니다.` as `FieldHelp`. Whisper uses a local privacy notice and status indicator. API key uses a credential card plus a separately spaced danger zone. Do not surface `descriptor.availability.message`.

- [ ] **Step 5: Run all settings/provider tests and inspect the exact dirty-file merge**

Run: `npm test -- tests/unit/api-key-settings.test.tsx tests/unit/processing-provider-settings.test.tsx tests/unit/provider-registry.test.ts tests/unit/whisper-model-manager.test.ts tests/unit/codex-command-resolver.test.ts && npm run typecheck`

Expected: user-authored tests and new hierarchy tests PASS; no local path appears in rendered output.

Run: `git diff --check && git diff -- src/renderer/src/features/settings tests/unit/processing-provider-settings.test.tsx`

Expected: the diff retains the cloud/local distinction, four error mappings, refresh button and non-mutation behavior.

- [ ] **Step 6: Commit only the reconciled settings work**

```powershell
git add src/renderer/src/features/settings/ApiKeySettings.tsx src/renderer/src/features/settings/ProcessingProviderSettings.tsx src/renderer/src/features/settings/CodexCliStatus.tsx src/renderer/src/features/settings/WhisperModelSettings.tsx src/renderer/src/styles/app.css tests/unit/api-key-settings.test.tsx tests/unit/processing-provider-settings.test.tsx
git commit -m "🎨 feat: organize settings help and provider status"
```

---

### Task 8: Make visual fixtures exercise the real App and actual viewport

**Files:**
- Modify: `tests/visual/harness/src.tsx`
- Modify: `tests/visual/task10.visual.pw.ts`
- Modify: `tests/visual/processing-settings.visual.pw.ts`
- Modify: `tests/e2e/app.spec.ts`
- Add/update: `tests/visual/snapshots/win32/*.png`
- Add/update on macOS runner: `tests/visual/snapshots/darwin/*.png`

**Interfaces:**
- Consumes: real `<App desktopApi={fixtureApi} recordingController={fixtureController} />`.
- Produces: route-aware light/dark visual baselines and actual Electron viewport assertions.

- [ ] **Step 1: Add failing real-route and viewport assertions**

Add a Playwright helper that navigates through UI rather than returning feature components:

```ts
async function openRoute(page: Page, state: string) {
  await page.goto(`/?state=${state}`)
  if (state === 'templates') await page.getByRole('button', { name: '요약 템플릿' }).click()
  if (state === 'settings' || state.startsWith('provider-') || state.startsWith('whisper-') || state.startsWith('codex-')) {
    await page.getByRole('button', { name: '설정' }).click()
  }
  expect(await page.evaluate(() => scrollY)).toBe(0)
}
```

Add to real Electron E2E after opening settings:

```ts
await window.getByRole('button', { name: '설정' }).click()
await expect(window.getByRole('heading', { name: '설정' })).toBeInViewport()
expect(await window.evaluate(() => ({ scrollY, theme: document.documentElement.dataset.theme, background: getComputedStyle(document.body).backgroundColor }))).toMatchObject({ scrollY: 0, theme: expect.stringMatching(/light|dark/) })
await expect(window.getByRole('button', { name: '전체 기록' })).toBeVisible()
```

- [ ] **Step 2: Run route visuals without updating and confirm baseline/harness failures**

Run: `npm run test:visual -- tests/visual/task10.visual.pw.ts tests/visual/processing-settings.visual.pw.ts`

Expected: FAIL because current harness bypasses `App`, route buttons do not drive every state, and old Linear snapshots differ.

- [ ] **Step 3: Refactor harness to render App with deterministic fixtures**

Keep the existing meeting, template, provider and model data but expose it through one fixture `DesktopApi`. Always render:

```tsx
createRoot(document.getElementById('root')!).render(
  <App desktopApi={desktopApiFor(state)} recordingController={recordingControllerFor(state)} />,
)
```

Do not directly return `Dashboard`, `MeetingDetail`, `TemplateEditor`, `ApiKeySettings`, or `ProcessingProviderSettings`. Visual tests must click the navigation or meeting row to reach those routes. Add a test-only query parameter `theme=light|dark` by seeding `localStorage['nnote.theme']` before render; production code receives no test branch.

- [ ] **Step 4: Replace fullPage-only assertions with viewport and full-document pairs**

For dashboard, templates and settings, capture `fullPage: false` at 1200×800 and assert the page heading and primary action are in viewport. Keep one full-page meeting document capture for long content. At 938×800 and 640×800 assert `documentElement.scrollWidth <= innerWidth`. Add light dashboard/settings and dark dashboard/settings baselines.

- [ ] **Step 5: Update reviewed Windows snapshots and run real Electron E2E**

Run:

```powershell
npm run test:visual:update -- tests/visual/task10.visual.pw.ts tests/visual/processing-settings.visual.pw.ts
npm run build
npm run test:e2e
```

Expected: Windows snapshots update; real built Electron launches, CSS computed background is not transparent/default, settings heading is in viewport at scrollY 0, recording smoke passes.

- [ ] **Step 6: Inspect every changed PNG before committing**

Open every updated Windows PNG at original resolution. Confirm:

1. Reported pixels: template/settings are no longer compressed or dark-Linear leftovers; route heading is not clipped.
2. Rendering source: actual AppShell, feature component and semantic theme CSS.
3. Verified visible change: white/coral light hierarchy, warm-charcoal dark option, visible primary actions at 1200×800.
4. Regression test: named viewport and route tests in this task.

- [ ] **Step 7: Commit harness, E2E and reviewed baselines**

```powershell
git add tests/visual/harness/src.tsx tests/visual/task10.visual.pw.ts tests/visual/processing-settings.visual.pw.ts tests/e2e/app.spec.ts tests/visual/snapshots/win32
git commit -m "🧪 test: verify redesigned UI through real routes"
```

On macOS, run `npm run test:visual:update` and commit only `tests/visual/snapshots/darwin` after original-resolution inspection.

---

### Task 9: Produce before/after documentation screenshots

**Files:**
- Modify: `tests/visual/feature-docs.pw.ts`
- Modify: `tests/unit/before-screenshots.test.ts`
- Modify: `docs/screenshots/README.md`
- Create: `docs/screenshots/after-airbnb/*.png`

**Interfaces:**
- Consumes: route-aware visual harness from Task 8.
- Produces: preserved Before/Linear checksums and Airbnb result set.

- [ ] **Step 1: Expand preservation tests before generating new images**

Extend `before-screenshots.test.ts` with a second immutable map for all existing `docs/screenshots/after-linear/*.png`. Compute current values with:

```powershell
Get-ChildItem docs/screenshots/after-linear/*.png | ForEach-Object { $hash = (Get-FileHash $_ -Algorithm SHA256).Hash.ToLowerInvariant(); "'$($_.Name)': '$hash'," }
```

The test continues to read each exact path and compare SHA-256 byte-for-byte.

- [ ] **Step 2: Run preservation tests before touching docs images**

Run: `npm test -- tests/unit/before-screenshots.test.ts`

Expected: original and after-linear checksum cases PASS.

- [ ] **Step 3: Point documentation capture to after-airbnb and actual routes**

Change output only:

```ts
const output = (name: string) => resolve('docs', 'screenshots', 'after-airbnb', name)
```

Use `openRoute` semantics from Task 8. Capture the 13 existing named feature states plus `14-theme-light.png` and `15-theme-dark.png` at deterministic Windows 1200×800. Dashboard/settings/template use viewport screenshots; meeting detail may use fullPage.

- [ ] **Step 4: Generate and inspect every documentation screenshot**

Run: `npm run test:visual -- tests/visual/feature-docs.pw.ts`

Expected: `docs/screenshots/after-airbnb` contains 15 non-empty PNG files and no older directory checksum changes.

Inspect all 15 images at original resolution. Reject the set if any heading, primary action, field label, troubleshooting step, dialog action, or 640px responsive content is clipped.

- [ ] **Step 5: Document the comparison paths and commit**

Update README with three explicit columns/links: original Before, after-linear, after-airbnb. Note that Airbnb images are 1200×800 viewport except the long meeting document.

Run: `npm test -- tests/unit/before-screenshots.test.ts && git diff --check`

Expected: checksums PASS and no whitespace errors.

Commit:

```powershell
git add tests/visual/feature-docs.pw.ts tests/unit/before-screenshots.test.ts docs/screenshots/README.md docs/screenshots/after-airbnb
git commit -m "📸 docs: add Airbnb redesign comparison screenshots"
```

---

### Task 10: Full verification and scope-leakage review

**Files:**
- Review: every changed file since plan execution began
- Modify only if verification exposes a scoped defect; add a failing regression test before that fix.

**Interfaces:**
- Produces: verified, reviewable redesign branch; no release or tag in this plan.

- [ ] **Step 1: Run the complete static and automated suite**

Run:

```powershell
npm run lint
npm run typecheck
npm test
npm run test:visual
npm run build
npm run test:e2e
```

Expected: all commands exit 0. Visual tests may skip unsupported platform snapshots but must explicitly run Windows baselines on this machine.

- [ ] **Step 2: Run explicit responsive and secret scans**

Run:

```powershell
rg -n "sk-[A-Za-z0-9_-]+|Authorization:|C:/secret|Users[/\\]" docs/screenshots tests/visual/snapshots src/renderer/src
rg -n "style=\{\{|Airbnb Cereal|Circular" src/renderer/src package.json
```

Expected: no secrets or user-local paths; no proprietary Airbnb font reference; no remaining visual inline style in redesigned components.

- [ ] **Step 3: Review diff for locked-scope leakage**

Run:

```powershell
git diff 1c24207..HEAD --stat
git diff 1c24207..HEAD -- src/main src/preload src/shared
git status --short
```

Expected: Main, Preload, shared contracts and database are unchanged. Every modified file belongs to Renderer UI, tests, `DESIGN.md`, package font dependency, or screenshot documentation. No untracked generated app data or API key file exists.

- [ ] **Step 4: Perform final original-pixel checklist**

At 1200×800, 938×800 and 640×800 in real Electron or the route-aware App harness, record:

- Reported pixels: all named pages and both themes.
- Rendering source: exact component and CSS file for each visible result.
- Verified visible change: heading visible at top, primary action visible, no horizontal overflow, settings help in correct conditional state.
- Regression test: exact test name covering each result.

- [ ] **Step 5: Commit only verification fixes, if any**

If no defect is found, do not create an empty commit. If a defect is found, return to the task that owns the affected component, add the failing test named for the visible outcome, make the smallest scoped fix, rerun that task's focused suite plus the complete suite, and use that task's explicit `git add` file list. Use commit message `🐛 fix: correct redesigned viewport regression` only for a viewport defect; use a message naming the actual scoped defect otherwise.

- [ ] **Step 6: Use finishing-a-development-branch for integration handoff**

Invoke `superpowers:finishing-a-development-branch`, confirm all verification output is fresh, and present merge/PR choices. Do not create a new GitHub release or modify `v0.0.1` as part of this redesign plan.
