# Windows development CSS CSP fix

## Scope

Fix only the Electron/Vite development renderer, where the dashboard currently renders without CSS. Packaged Windows and macOS CSP, application behavior, recording, persistence, and release artifacts must not change.

## Root cause

Vite serves imported CSS as JavaScript that creates an inline `<style>` element. The renderer HTML currently ships `style-src 'self'`, so Electron blocks that development-only style injection. Production builds extract CSS into a same-origin file and are unaffected.

## Design

Add a small Vite HTML-transform plugin to the renderer configuration. When a Vite development server is present, replace only `style-src 'self'` with `style-src 'self' 'unsafe-inline'` in the served HTML. Build output must retain the strict `style-src 'self'` policy.

## Regression coverage

- Changed behavior: development HTML permits Vite's inline CSS injection.
- Unchanged behavior: production renderer HTML continues to reject inline styles and remote scripts.
- Pixel verification: restart `npm run dev` and inspect the actual Nnote window for the dark canvas, bordered panels, lavender action, and styled controls.

## Acceptance

The development window matches the existing dashboard screenshot rather than browser-default controls, while the production CSP test and full test suite remain green.
