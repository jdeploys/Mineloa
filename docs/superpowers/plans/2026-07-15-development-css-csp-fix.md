# Development CSS CSP Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the existing styled dashboard in the Windows Electron/Vite development window without weakening packaged builds.

**Architecture:** Export a pure HTML CSP transformer from the Electron Vite configuration and invoke it only from a development-server HTML transform hook. Production builds continue using the unchanged static CSP from `src/renderer/index.html`.

**Tech Stack:** TypeScript, electron-vite, Vite HTML transform hooks, Vitest

## Global Constraints

- Change only the Electron/Vite development renderer CSS loading behavior.
- Do not change packaged Windows/macOS CSP, recording, persistence, or release artifacts.
- Add paired regression coverage for the changed development behavior and unchanged production behavior.
- Verify the actual Nnote window pixels after restarting `npm run dev`.

---

### Task 1: Development-only CSP transform

**Files:**
- Create: `tests/unit/development-renderer-csp.test.ts`
- Modify: `electron.vite.config.ts`

**Interfaces:**
- Consumes: renderer HTML containing `style-src 'self'`.
- Produces: `allowViteDevelopmentStyles(html: string): string`, used only by the Vite development server transform.

- [ ] **Step 1: Write the paired failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { allowViteDevelopmentStyles } from '../../electron.vite.config'

const strictHtml = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'">`

describe('renderer CSP modes', () => {
  it('development renderer CSP permits Vite inline CSS injection', () => {
    expect(allowViteDevelopmentStyles(strictHtml)).toContain("style-src 'self' 'unsafe-inline'")
  })

  it('production renderer CSP remains strict', () => {
    expect(strictHtml).toContain("style-src 'self'")
    expect(strictHtml).not.toContain("'unsafe-inline'")
  })
})
```

- [ ] **Step 2: Confirm the new test fails before implementation**

Run: `npx vitest run tests/unit/development-renderer-csp.test.ts`

Expected: FAIL because `allowViteDevelopmentStyles` is not exported.

- [ ] **Step 3: Add the minimal development-only transform**

```ts
import type { Plugin } from 'vite'

export function allowViteDevelopmentStyles(html: string): string {
  return html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
}

const developmentRendererCsp = (): Plugin => ({
  name: 'nnote-development-renderer-csp',
  apply: 'serve',
  transformIndexHtml: allowViteDevelopmentStyles,
})
```

Add `developmentRendererCsp()` to the renderer plugin list before `react()`.

- [ ] **Step 4: Verify tests and production output**

Run: `npx vitest run tests/unit/development-renderer-csp.test.ts tests/unit/window-security.test.ts`

Expected: both changed and unchanged mode tests PASS.

Run: `npm run typecheck && npm run test && npm run build`

Expected: all commands exit 0; built renderer HTML contains `style-src 'self'` and does not contain `style-src 'self' 'unsafe-inline'`.

- [ ] **Step 5: Restart and visually verify Windows development mode**

Stop the Nnote development process tree started by this task, run `npm run dev`, and capture the actual Nnote window. Verify the dark canvas, bordered panels, lavender primary action, and styled buttons/selects replace the browser-default pixels.

- [ ] **Step 6: Review scope and commit**

Run: `git diff --check && git status --short`.

Confirm every modified file belongs to the development CSS fix, then commit with `🐛 fix: load styles in development renderer`.
