# Task 10d Phase B: Native macOS visual baseline report

## Scope and provenance

- GitHub Actions run: `29575650241`
- Workflow / event: `record-macos-visual-baselines` / `workflow_dispatch`
- Branch / head: `codex/airbnb-redesign` / `969d9b3930cf1ed24765496ea67079ad57975cd8`
- Job: `87869367527` (`record`), successful, runner label `macos-15`
- Runner: `GitHub Actions 1000000123`, GitHub-hosted runner group
- Artifact: `8404927830`, `macos-visual-baselines-969d9b3930cf1ed24765496ea67079ad57975cd8`
- Artifact size: `2,377,417` bytes
- Artifact digest reported by GitHub: `sha256:77e75e04940f60131bb95b945aa2bec5bcadcbf6ea87efeae06f7deaaebc9306`
- Artifact path inspected: `.superpowers/sdd/macos-run-29575650241/macos-visual-baselines-969d9b3930cf1ed24765496ea67079ad57975cd8`

The run, job, and artifact metadata were queried independently with `gh run view` and the GitHub Actions run, job, and artifact APIs. The run and recording job both completed successfully. Every tracked Darwin PNG is byte-identical to both its downloaded artifact candidate and its individual runner `*-actual.png` result.

The downloaded artifact contained 21 files under its Darwin snapshot directory because checkout preserved the obsolete `dashboard-idle.png`. The current win32 suite defines the expected 20-file manifest. The approved Darwin set matches those 20 names exactly and excludes the stale file.

No Windows image was copied, converted, or used to generate a Darwin baseline. Windows files were read only to validate the expected filename set and dimensions. All 20 Darwin hashes differ from their win32 counterparts.

## Approved native Darwin manifest

| File | Dimensions | SHA-256 |
| --- | ---: | --- |
| `dashboard-active.png` | 1200x800 | `b8086309322720a4d75bab0c34f803bf9b98bc3d7f76d34c6efc9f17dfb3d57a` |
| `dashboard-failed.png` | 1200x800 | `924ce28afa7384cc39fbfc7fc3a453770b2653e64055cc9429a52474954583bd` |
| `dashboard-idle-dark.png` | 1200x800 | `b760b5dc537186286d84df0d2e756374dbac5156358ab3f77cb4105576659418` |
| `dashboard-idle-light.png` | 1200x800 | `9aeb5785a68086b31670e0b19ac419fc6781ee4b081c4162162cc155f50a0fa5` |
| `dashboard-narrow-640.png` | 640x800 | `2bb0d91971df8e2f23c9e572fc45db4da14765fdac256c7d63fc73618cdf07ae` |
| `dashboard-recoverable.png` | 1200x800 | `8b45059d459a805c99646d71d4851c6a139c1c9dc93ef3d537b9e6c68ec989f3` |
| `meeting-detail-completed.png` | 1200x1942 | `4ad6b6d7300ca5e6dd0f1374145a80614b298c492168b92c893a417e4db5d185` |
| `processing-codex-available.png` | 1200x800 | `39f52d72a7c71e3615d6a908c04b79fd317f809ce2c4e36d6d9661a5c27255eb` |
| `processing-codex-unavailable.png` | 1200x800 | `8cb3f3778cc8978888e5c4b9e920fa1a77844b60c7e03b0daa7d9bd65b64307e` |
| `processing-providers-advanced.png` | 1200x800 | `ac52f95138bedcd27b2928dfef9765d199150300bfe03901abf021c2fc75e985` |
| `processing-providers-defaults.png` | 1200x800 | `422ed0cc8ff5dd7d094b0f1e07034e865b5c787c42153be753b0e98d4dd84c1b` |
| `processing-whisper-downloading.png` | 1200x800 | `284ec552e98e134d47562a0e66cac60c257f70f9e9e021fa03c5b89013c0b971` |
| `processing-whisper-installed.png` | 1200x800 | `bfbc18c4556eefba5c7dd76d0502e67be0787c5d5409e9b126952fd69ed461b3` |
| `responsive-compact-721.png` | 721x800 | `0d06db65d1e3d951ecca590a131ea7f197f3037d58816731b1797b3ea92c2301` |
| `responsive-compact-743.png` | 743x800 | `ced0713462de9d71a71bc4a5340a3055b33c2e03fee5ae012d463b913555ca33` |
| `responsive-noncompact-744.png` | 744x800 | `2524520d040d27a95a91035b9ec1458246c39759d810549a98a57a9bcd7da084` |
| `responsive-noncompact-938.png` | 938x800 | `d9964497a8d3c47a8c8ad3bdb40c96823730b8276fb74e666ed1e2200f2c87ed` |
| `settings-dark.png` | 1200x800 | `0fd7cf97a7abf68a7ae8d94d328885365f3f8997eb1c8cfce1dbe89222a874b1` |
| `settings-light.png` | 1200x800 | `960e20716ca0f497677dd09727f4e324da984d683326675ca1e89efe5c568db1` |
| `templates-light.png` | 1200x800 | `80e517f86cc9b9fd12319df0f94ee8d4fa4ca84ed9bd3789524769e919fc5f58` |

Every file decoded successfully as an opaque RGB PNG. Dimensions match the corresponding current win32 baseline and the viewport/full-page contract encoded by the visual test name.

## Original-resolution inspection checklist

- [x] Idle dashboards render the correct light and warm-charcoal themes, route navigation, empty-library state, selectors, and primary action.
- [x] Active, failed, and recoverable dashboards render the intended recording or processing status, current library rows, semantic badges, and available actions without clipping.
- [x] The 640px dashboard stacks cleanly with reachable controls and no horizontal overflow.
- [x] The template route shows the template list, editor fields, section controls, save action, and deletion hierarchy at the expected viewport position.
- [x] Light and dark settings screenshots show the correct theme selection and API-key hierarchy with legible selected, disabled, primary, and danger treatments.
- [x] Provider default/advanced states show the expected collapsed or expanded advanced options and provider selections.
- [x] Codex available/unavailable states show the correct status; unavailable includes the troubleshooting steps and retry action, while available omits that troubleshooting block.
- [x] Whisper installed/downloading states show the correct local-processing copy, model state, action, progress, and percentage.
- [x] The full-document completed meeting uses the correct route, status, audio/processing section, summary hierarchy, action items, speaker names, transcript, and collapsed preview without bottom truncation.
- [x] The responsive seam is correct: 721px and 743px use the compact stacked layout; 744px and 938px use the noncompact two-column layout. Navigation, cards, controls, and text remain inside each viewport.
- [x] All 20 files were opened at original resolution. No wrong route, wrong theme, unintended content clipping, help-hierarchy regression, overflow, or stale pre-redesign composition was found.

One transient image-viewer rendering showed black masks over `dashboard-failed.png`. Independent decoding proved the source is opaque RGB with no black rectangle or transparency; the tracked file, artifact candidate, and runner actual are byte-identical. Reopening the same original file rendered normally.

## Regression and local verification

The new unit regression requires the supported `win32` and `darwin` baseline filename sets to match exactly and explicitly excludes `dashboard-idle.png`.

- RED against pre-Phase-B `969d9b3`: win32 had 20 names, Darwin had 12; nine current names were missing and stale `dashboard-idle.png` was extra.
- GREEN on the approved working set: focused package-config and visual-platform tests passed, 23/23.
- Full Vitest: 55 files passed; 572 tests passed and 1 was skipped.
- ESLint: passed with zero warnings.
- TypeScript static checks: both projects passed.
- A Darwin visual comparison was not run locally on Windows.

## Remaining remote gate

After this commit is independently reviewed and pushed, the normal `mac-visual-baseline` CI job must compare the committed Darwin baselines without `--update-snapshots`. No release or tag was created during this phase.
