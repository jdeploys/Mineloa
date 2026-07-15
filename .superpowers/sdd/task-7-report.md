# Task 7 report — local runtime packaging and release verification

## Scope lock

- Changed only local-runtime build/package verification, platform packaging, release CI, and the Task 6 macOS visual baseline gate.
- Did not change provider selection, processing behavior, recording, recovery, archive, retention, or downloaded-model storage.
- Did not push, move a tag, replace release assets, or claim that a packaged helper is currently installed.

## RED evidence

Command:

```text
npx vitest run tests/unit/local-runtime-build-contract.test.ts tests/unit/package-config.test.ts tests/unit/runtime-package-verification.test.ts
```

Observed before implementation: 3 files failed; 8 tests failed and 6 passed. Failures were the expected missing build scripts/notices, missing platform `extraResources`, missing `verifyLocalRuntimePayload`, absent `localRuntime` signal, and release workflow still using `gh release create`.

A second focused RED cycle pinned immutable source commits. The two script-contract cases failed until both scripts checked:

- whisper.cpp v1.9.1: `f049fff95a089aa9969deb009cdd4892b3e74916`
- FFmpeg n8.1.2: `1c2c67c0b9f7f66ab32c19dcf7f227bcd290aa4c`

## GREEN implementation

- Added fail-closed native PowerShell/macOS build scripts with exact LGPL-compatible FFmpeg flags, fixed source tags and commits, native-architecture checks, cleanup, licenses, notices, and manifest emission.
- Added platform/architecture-specific electron-builder resources. Downloaded `ggml-base.bin`/`ggml-small.bin` models are not packaged.
- Added manifest verification for schema, pinned versions/commits, target, canonical containment, regular/non-symlink files, macOS executable bits, size, SHA-256, and required notices/licenses.
- Extended the real packaged-app launch signal with exact `localRuntime: true`; `scripts/verify-package.mjs` now requires it.
- Added nested-helper signing before app signing. With no credentials the workflow performs an explicit ad-hoc app fallback and records `UNNOTARIZED`; with signing and notarization credentials it enables notarization and requires `spctl` assessment.
- Added native macOS Task 6 visual snapshot generation/comparison and artifact upload. Windows-generated images are never copied into the Darwin baseline directory.
- Changed tag publication to `gh release upload v0.0.1 --clobber` followed by `gh release edit`; `workflow_dispatch` never reaches the tag-only release job.

## Verification evidence

Focused GREEN:

```text
Test Files 3 passed (3)
Tests 14 passed (14)
```

Full requested local verification:

```text
npm rebuild better-sqlite3
npm run typecheck
npm run lint
npm test
npm run build
```

Observed:

- native dependency rebuild: success
- TypeScript: success
- ESLint: success, zero warnings
- Vitest: 50 files passed, 474 tests passed
- electron-vite production build: success
- Windows processing-settings pixel comparison: 7 passed (existing reviewed baselines unchanged)
- PowerShell and Node build/signing script syntax checks: `SCRIPT_SYNTAX_OK`
- release YAML parsed successfully with PyYAML
- `git diff --check`: success

## Explicit unresolved CI/runtime facts

- This Windows machine has neither `cmake` nor MSYS2 (`C:\msys64\usr\bin\bash.exe` absent). Per the brief, no large native toolchain download/build was started locally. Therefore no local Windows package-launch `localRuntime: true` claim is made.
- macOS x64/arm64 helper builds, app launch signals, native visual baselines, codesign diagnostics, and any notarization result require the real GitHub macOS runners. The workflow uploads all of these diagnostics.
- The repository currently has no configured signing/notarization secrets. The expected current macOS result is ad-hoc signed and explicitly unnotarized. A clean Gatekeeper/notarization claim remains blocked until credentials exist and CI reports `NOTARIZATION VERIFIED`.
- Existing `v0.0.1` assets were not changed by this task. The tag workflow must complete successfully before replacing them.

## Review remediation

- Runtime truth now requires matching PE x64 or thin Mach-O x64/arm64 headers and successful bounded, shell-free `whisper-cli --help` / `ffmpeg -version` probes. Hash-valid text, wrong architecture, and spawn/missing-DLL failures are regression tested and cannot emit `localRuntime: true`.
- The manifest is read through `O_NOFOLLOW`, `FileHandle.stat()`, path/open identity comparison, a 128 KiB bound, and exact reads. A real manifest symlink test runs where the host permits link creation. The remaining same-user path swap between closing the verified helper handle and spawning by pathname is a platform API limitation: Node exposes neither Windows handle execution nor portable `execveat`; the runtime still rechecks canonical containment and manifest hash before that boundary.
- Complete Developer ID signing now requires `CSC_LINK`, `CSC_KEY_PASSWORD`, and explicit `MAC_CSC_NAME`, exposed only to the package step. Nested helpers receive that exact identity before the app, and CI compares their complete Authority chain and TeamIdentifier with the app.
- Ad-hoc fallback disables hardened runtime and signs without the runtime option. Developer ID without notarization and ad-hoc/unnotarized states are reported separately.
- Release CI only compares committed Darwin baselines. The explicit manual `record-macos-visual-baselines` workflow produces candidate artifacts; `docs/release/macos-visual-baselines.md` documents inspect-then-commit review.
- Every action in every repository workflow is pinned to a 40-character commit SHA. Default permissions are `contents: read`; only the release job has `contents: write`.

Post-review full verification observed 50 test files and 484 tests passing, TypeScript and ESLint passing, the production build succeeding, Windows processing-settings pixels passing 7/7, and all workflow YAML/action-pin static checks passing.

## Signing/hash order remediation

- The installed electron-builder 26.15.3 schema and `MacConfiguration` type define `signIgnore` as a regex or regex array. Its installed `MacTargetHelper` compiles each value with `new RegExp()` and tests the full file path. Package configuration now ignores exactly the final `whisper-cli` and `ffmpeg` paths below `Contents/Resources/local-runtime/darwin-(x64|arm64)`.
- `afterPack` signs both helpers with the final explicit Developer ID identity or `-`, then calls the manifest writer with `replaceExisting: true`. A behavior test uses a fake signer that changes both helper byte streams and the real writer; the resulting manifest SHA-256 values match those final signed bytes and the observed order is `whisper`, `ffmpeg`, `manifest`.
- Manifest replacement now requires an existing contained regular non-symlink manifest, opens it with `O_NOFOLLOW`, checks path/open identity, writes and fsyncs an exclusive temporary file inside the owned runtime directory, rechecks destination identity, and atomically renames. A real symlink target regression preserves the outside file.
- Electron-builder does not re-sign the ignored helpers. The fallback `afterSign` signs only the outer app without `--deep`, sealing the already-final helpers and refreshed manifest without mutating children.
- Release notes now use state-neutral signing/notarization language and direct users to the workflow diagnostics.

Post-order-fix verification observed 51 test files and 488 tests passing, with typecheck, lint, production build, workflow YAML/action pins, Node script syntax, and diff checks all succeeding.

## electron-builder keychain readiness remediation

- The Developer ID `afterPack` path now awaits `context.packager.codeSigningInfo.value` before either nested helper is signed. This is electron-builder's lazy keychain-import boundary; the returned `keychainFile`, when present, is passed to both `codesign` calls with `--keychain`.
- The installed electron-builder `CodeSigningInfo` contract exposes only `keychainFile`, not the resolved certificate identity. The strongest available identity check is therefore to validate the explicit non-empty `CSC_NAME` value and pass that exact value to `codesign --sign`; `codesign` resolves it inside the imported keychain. When `CSC_LINK` is configured, a missing keychain path fails closed.
- The ad-hoc path returns before accessing `codeSigningInfo.value`, uses no keychain argument, and retains `--sign -`. Its paired regression supplies a rejecting lazy value and verifies it is never read.
- The signed-path regression verifies the observable order `codeSigningInfo`, `whisper-cli`, `ffmpeg`, `manifest`, checks both signer argument lists for the keychain and explicit identity, mutates helper bytes through the signer runner, and confirms the refreshed manifest hashes those final bytes.

Post-keychain-fix verification observed 51 test files and 490 tests passing, with typecheck, ESLint, production build, Node syntax, workflow YAML/action pins, and diff checks all succeeding.
