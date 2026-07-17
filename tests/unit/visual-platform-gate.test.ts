import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { hasTask10VisualBaseline } from '../visual/platformSupport'

describe('Task 10 visual baseline platform gate', () => {
  it('runs Windows and macOS comparisons and skips unsupported Linux', () => {
    expect(hasTask10VisualBaseline('win32')).toBe(true)
    expect(hasTask10VisualBaseline('darwin')).toBe(true)
    expect(hasTask10VisualBaseline('linux')).toBe(false)
  })

  it('keeps supported Darwin baseline filenames aligned with Windows and excludes stale snapshots', () => {
    const snapshotNames = (platform: 'win32' | 'darwin') => readdirSync(
      resolve('tests/visual/snapshots', platform),
    ).filter((name) => name.endsWith('.png')).sort()
    const windows = snapshotNames('win32')
    const darwin = snapshotNames('darwin')

    expect(darwin).toEqual(windows)
    expect(darwin).not.toContain('dashboard-idle.png')
  })

  it('uses the Airbnb light and warm-charcoal theme contract without legacy decoration', () => {
    const themes = readFileSync(resolve('src/renderer/src/styles/themes.css'), 'utf8')
    const styles = readFileSync(resolve('src/renderer/src/styles/app.css'), 'utf8')
    const harness = readFileSync(resolve('tests/visual/harness/visual.css'), 'utf8')

    expect(themes).toContain('--canvas: #ffffff')
    expect(themes).toContain('--primary: #ff385c')
    expect(themes).toContain(":root[data-theme='dark']")
    expect(themes).toContain('--canvas: #171513')
    expect(`${themes}\n${styles}`).not.toMatch(/Georgia|linear-gradient|#176c4f/i)
    expect(`${themes}\n${styles}`).not.toMatch(/Airbnb Cereal|Circular/i)
    expect(harness).toContain('background: var(--canvas)')
    expect(harness).not.toContain('#fbfaf6')
  })
})
