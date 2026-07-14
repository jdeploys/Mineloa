import { describe, expect, it } from 'vitest'
import { redactSecrets } from '../../src/main/ai/redactSecrets'

describe('redactSecrets', () => {
  it('removes authorization values, OpenAI keys, and absolute recording paths', () => {
    const windowsPath = String.raw`C:\Users\person\Nnote\recordings\meeting.part-0.webm`
    const unixPath = '/Users/person/Nnote/recordings/meeting.part-1.webm'
    const value = `Authorization: Bearer sk-project-secret failed for ${windowsPath} and ${unixPath}`

    const redacted = redactSecrets(value, [windowsPath, unixPath])

    expect(redacted).toContain('[REDACTED]')
    expect(redacted).not.toContain('sk-project-secret')
    expect(redacted).not.toContain(windowsPath)
    expect(redacted).not.toContain(unixPath)
    expect(redacted).not.toMatch(/Authorization:\s*Bearer/i)
  })

  it('does not alter a safe user-facing error', () => {
    expect(redactSecrets('The audio file is invalid.')).toBe('The audio file is invalid.')
  })
})
