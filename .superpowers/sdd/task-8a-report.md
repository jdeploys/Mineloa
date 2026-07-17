# Task 8a Report: Appearance theme radio geometry

## Status and locked scope

Implemented the separately scoped Settings > Appearance radio correction for light and dark themes at 1200×800 and 640×800. The production change is limited to Appearance-specific CSS; theme preference state, radio markup and accessibility semantics, text inputs, API/IPC behavior, settings help, routes, and non-settings screens were not changed.

Only the justified Windows settings baselines `settings-light.png`, `settings-dark.png`, and `processing-providers-defaults.png` were regenerated. The provider-defaults viewport includes the bottom of the Appearance fieldset; original-pixel diff review confirmed its 544 changed pixels were the corrected radios only. No Darwin snapshot was added, removed, copied, or modified.

## Root-cause evidence

The Task 8 `settings-light.png` and `settings-dark.png` originals showed native radio circles centered above text labels. Real-App computed-style inspection identified both contributors:

- `globals.css` applies `min-height: 48px` to every `input`, so the native radios rendered 48px tall.
- `app.css` applies `display: grid; gap: 7px` to every direct settings-section label. Each radio stretched across the single 817px desktop / 529px compact grid track and put its text on a separate row, making each label about 78px tall.

The minimal correction keeps the global text-input rule intact and adds only `.theme-options` / `.appearance-settings .theme-options` rules: 12px option spacing, flex-row label alignment with an 8px gap, and an 18×18px radio-specific size/reset.

## TDD evidence

### RED

The named real-rendered regression was added before production CSS changed:

```text
npx playwright test tests/visual/processing-settings.visual.pw.ts -g "compact, label-aligned theme radios" --reporter=line
4 failed
1200×800 light/dark: expected radio width <= 20, received 817
640×800 light/dark: expected radio width <= 20, received 529
```

The paired text-input contract passed on the unchanged baseline:

```text
npx playwright test tests/visual/processing-settings.visual.pw.ts -g "API-key text input full-width sizing" --reporter=line
4 passed
```

### GREEN

After the Appearance-scoped CSS correction:

```text
npx playwright test tests/visual/processing-settings.visual.pw.ts -g "compact, label-aligned|API-key text input full-width sizing" --reporter=line
8 passed
```

Fresh computed geometry in all four light/dark × 1200/640 cases was:

- radio: 18×18px, `min-height: 18px`, zero padding;
- label: 20.016px tall flex row, vertically centered, 8px gap;
- API-key input: unchanged at 735.844×48px desktop and 566×48px compact, `min-height: 48px`, 12px padding;
- horizontal overflow: false.

## UI Visual Fix Rule

1. **Reported pixels:** The three Appearance radios were oversized 48px circles centered in full-width rows, with each visible label detached beneath its radio in both light and dark settings views.
2. **Rendering source:** `AppearanceSettings.tsx` supplies the native radio group. `globals.css` supplied the generic 48px input minimum; `app.css` supplied the inherited grid-label layout and now contains the narrow Appearance-specific correction.
3. **Verified visible change:** Original-resolution 1200×800 Windows settings captures and 640×800 light/dark captures show three compact 18px native circles horizontally aligned with their label text. The settings help remains visible, the API-key input pixels retain their prior full-width 48px sizing, and all four viewports have no horizontal overflow.
4. **Regression test:** `real settings <theme> keeps compact, label-aligned theme radios at <width>x800` measures radio/text rectangles from the real App at 1200×800 and 640×800 in both themes. Its paired `real settings <theme> keeps API-key text input full-width sizing at <width>x800` test protects text-input geometry.

## Accessibility and adjacent behavior

- The DOM remains three native radios sharing `name="theme"` and the original system/light/dark accessible labels.
- A real Chromium keyboard check focused `light`, pressed ArrowRight, and observed `dark` focused and checked while `data-theme` updated to `dark`.
- Existing theme preference unit coverage passed 3/3, including system-mode preservation and manual selection.
- The exact Appearance field-help sentence remains asserted in every new radio geometry case.

## Verification

- Focused changed + paired Playwright: 8/8 passed.
- Complete scoped settings visual, no snapshot update: 18/18 passed.
- Task 10 + settings real-App visual, no snapshot update: 27/27 passed.
- Focused theme Vitest: 3/3 passed.
- Full Vitest after Node ABI restoration: 55 files passed; 550 passed, 1 skipped.
- `npm run typecheck`: passed.
- `npm run lint`: passed with zero warnings.
- `npm run build`: passed.
- Real built Electron E2E: 2/2 passed.
- Electron rebuild was followed by `npm rebuild better-sqlite3`; Node reported ABI 127 and `BETTER_SQLITE3_NODE_ABI_127_OK`.

The repository-wide `npm run test:visual` result was 31 passed and 9 failed. Every failure is in the pre-existing `feature-docs.pw.ts` documentation suite: those cases still expect query-string fixture states to directly open completed, template, or settings routes, while Task 8 changed the harness to require real App button/row navigation. The scoped real-App settings and Task 10 comparison tests pass; Task 8a did not expand scope into rewriting the legacy documentation harness. Four `after-linear` PNGs that this failing legacy run overwrote before timing out were restored to their exact committed bytes.
