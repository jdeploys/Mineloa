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
