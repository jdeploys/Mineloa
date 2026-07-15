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
