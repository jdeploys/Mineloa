# Task 10b report: WCAG AA primary controls and semantic badges

## Scope lock

- Changed pixels: primary-button foreground/surface pairs and the success, warning, danger, and active status-badge foreground/surface pairs in light and dark themes.
- Protected adjacent behavior: brand coral remains available for decoration and focus treatment; button hierarchy, component markup, routes, theme preference, layout, recording, provider, and template semantics are unchanged.
- Production diff: semantic tokens in `themes.css` and their existing narrow consumers in `globals.css` and `app.css` only.

## Root cause and TDD evidence

The root cause was token-role coupling. `--primary` was both the brand accent and the text-bearing primary-button surface, while badge foregrounds were either hardcoded light-theme colors or the brand active color. The same selectors were rendered on the warm-charcoal dark surfaces. Global disabled opacity also composited the already-low-contrast light disabled pair toward white.

RED was captured from the real `<App>` visual harness with `getComputedStyle`, rendered alpha/opacity compositing, and the WCAG relative-luminance formula before production CSS changed. Soft assertions measured every case in one run and kept nearby passing controls in the same evidence:

| Failing rendered pair | Pre-fix ratio |
| --- | ---: |
| Light primary | 3.516:1 |
| Light active badge | 4.399:1 |
| Light disabled primary | 1.210:1 |
| Dark primary | 3.014:1 |
| Dark primary hover/focus | 3.516:1 |
| Dark active badge | 4.227:1 |
| Dark success badge | 2.777:1 |
| Dark warning badge | 2.825:1 |

The paired secondary control, danger control/badge, light success badge, and light warning badge continued through the same RED run and remained passing. This prevented broadening the correction to neutral/secondary hierarchy.

## Implementation

- Preserved `--primary`, `--primary-active`, and `--primary-disabled` as brand/focus accents.
- Added semantic primary-action surface/foreground tokens for default, hover/active, and disabled states.
- Added theme-specific semantic badge foregrounds and an active badge surface token.
- Kept the primary action visually dominant with a deeper coral surface and white text; hover/active darkens further.
- Kept disabled primaries visually subordinate with a pale rose/dark rose light pair and muted charcoal/pale rose dark pair. The primary-specific disabled rule uses `opacity: 1` so its semantic pair is not degraded by the generic disabled opacity.

Computed WCAG pairs after the correction:

| Rendered semantic pair | Ratio |
| --- | ---: |
| Primary / primary hover (both themes) | 5.321:1 / 6.441:1 |
| Disabled primary light / dark | 8.492:1 / 7.844:1 |
| Success badge light / dark | 5.062:1 / 8.835:1 |
| Warning badge light / dark | 4.976:1 / 8.519:1 |
| Danger badge light / dark | 5.175:1 / 7.323:1 |
| Active badge light / dark | 5.791:1 / 7.088:1 |

## Regression coverage

`tests/visual/contrast.visual.pw.ts` mounts the real App at both 1200x800 and compact 640x800 in light and dark themes. It measures actual computed selectors, not disconnected token literals, and covers:

- enabled primary default, hover, and keyboard focus;
- an actually disabled API-key primary action, including rendered opacity;
- active recording, completed/recorded success, recoverable warning, and failed danger badges;
- paired nearby secondary and danger controls that must retain their hierarchy.

Result: 4/4 theme/viewport matrix cases passed, with every measured pair at or above 4.5:1.

## UI Visual Fix Rule evidence

1. **Reported pixels:** white labels on light/dark coral primary actions; success, warning, danger, and active small badge labels; primary hover/focus/disabled states.
2. **Rendering source:** primary pixels are rendered by `.ui-button[data-variant='primary']` / `.button-primary` in `globals.css`; badge pixels are rendered by `.status-badge[data-tone]` in `app.css`; their theme values come from `themes.css`.
3. **Verified visible change:** original-resolution Windows App captures were inspected for light and dark 1200x800 plus compact 640x800. The deeper coral primary stays dominant; active/success/warning/danger badge labels are legible without changing badge shape or layout; the disabled primary is visibly subordinate but readable. Hover, focus, disabled, provider status, active recording, failed, and recoverable states were also measured from real rendered selectors.
4. **Regression test:** `real light/dark App keeps primary controls and every semantic badge at WCAG AA contrast at 1200px/640px` in `tests/visual/contrast.visual.pw.ts`.

The 19 content-different Windows baselines and 13 generated `after-airbnb` documentation captures were refreshed because they contain corrected action/status pixels. No Darwin baseline, Original Before image, or `after-linear` image changed.

## Final verification

- Focused real-App contrast matrix: 4/4 passed.
- Focused Windows visual recapture: 31/31 passed.
- Full Windows visual suite: 50/50 passed.
- Full Vitest after ABI restoration: 55 files passed; 563 passed and 1 skipped.
- Typecheck: both TypeScript projects passed.
- Lint: passed with zero warnings.
- Build: Electron main, preload, and renderer passed.
- Electron E2E: 2/2 passed.
- ABI restoration: `npm rebuild better-sqlite3`; direct in-memory load reported `NODE_ABI=127 BETTER_SQLITE3_OK=1`.
- `git diff --check`: passed.

## Scope-leakage review

- Every production change belongs to one of the reported foreground/surface pairs.
- Component JSX, behavior, navigation, state transitions, layout, and data contracts are untouched.
- Neutral/secondary controls are measured as protected passing controls and were not rethemed.
- Updated images are Windows real-App outputs containing the corrected pixels; Darwin is untouched.
