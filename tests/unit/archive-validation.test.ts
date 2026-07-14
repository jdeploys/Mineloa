import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { MAX_ARCHIVE_BYTES, parseArchive } from '../../src/main/archive/archiveSchema'

const valid = {
  'manifest.json': strToU8(JSON.stringify({ format: 'nnote', version: 1, entries: ['meeting.json', 'transcript.json', 'summary.json'] })),
  'meeting.json': strToU8(JSON.stringify({ title: '회의', createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z', durationMs: 1, status: 'completed', audioPolicy: 'keep', template: null })),
  'transcript.json': strToU8(JSON.stringify({ speakers: [], segments: [] })),
  'summary.json': strToU8(JSON.stringify({ sections: [], actionItems: [] })),
}

describe('Nnote archive validation', () => {
  it('accepts the exact v1 semantic entry set', () => {
    expect(parseArchive(zipSync(valid)).meeting.title).toBe('회의')
  })

  it.each([
    ['traversal', { ...valid, '../meeting.json': strToU8('{}') }],
    ['absolute path', { ...valid, 'C:\\audio.webm': new Uint8Array() }],
    ['UNC path', { ...valid, '\\\\server\\audio.webm': new Uint8Array() }],
    ['Unicode separator', { ...valid, ['folder\u2215audio.webm']: new Uint8Array() }],
    ['extra audio', { ...valid, 'audio.webm': new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), 'AUDIO.WEBM': new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]) }],
  ])('rejects %s entries', (_name, entries) => {
    expect(() => parseArchive(zipSync(entries))).toThrow(/entry|archive|path/i)
  })

  it('rejects unsupported versions and malformed JSON', () => {
    const unsupported = { ...valid, 'manifest.json': strToU8(JSON.stringify({ format: 'nnote', version: 2, entries: [] })) }
    expect(() => parseArchive(zipSync(unsupported))).toThrow(/version/i)
    const malformed = { ...valid, 'meeting.json': strToU8('{') }
    expect(() => parseArchive(zipSync(malformed))).toThrow(/json/i)
  })

  it('rejects a declared entry larger than 100MB before decompression', () => {
    const archive = zipSync(valid)
    const dv = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    for (let offset = 0; offset + 46 < archive.byteLength; offset++) {
      if (dv.getUint32(offset, true) === 0x02014b50) {
        dv.setUint32(offset + 24, MAX_ARCHIVE_BYTES + 1, true)
        break
      }
    }
    expect(() => parseArchive(archive)).toThrow(/100MB/i)
  })
})
