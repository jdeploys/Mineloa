import { describe, expect, it } from 'vitest'
import { registerArchiveHandlers } from '../../src/main/ipc/registerArchiveHandlers'

function setup(dialog: any, repository: any) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  registerArchiveHandlers({ handle: (channel, listener) => handlers.set(channel, listener) }, dialog, repository, { findById: () => null }, {} as any, 'C:\\trusted\\recordings')
  return handlers
}

describe('archive IPC', () => {
  it('returns a typed cancellation without exposing a selected path', async () => {
    const meeting = { id: 'meeting-1', title: '회의', status: 'completed', audioPath: null, selectedTemplateId: null }
    const handlers = setup({ showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }, { requireById: () => meeting })
    expect(await handlers.get('archive:export-meeting')!({}, 'meeting-1')).toEqual({ status: 'cancelled' })
    expect(await handlers.get('archive:import-meeting')!({})).toEqual({ status: 'cancelled' })
  })

  it('does not expose a private audio path through typed export failure', async () => {
    const secret = 'C:\\Users\\private\\audio.webm'
    const meeting = { id: 'meeting-1', title: '회의', createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z', durationMs: 1, status: 'completed', audioPolicy: 'keep', audioPath: secret, audioByteCount: 1, selectedTemplateId: null }
    const handlers = setup({ showSaveDialog: async () => ({ canceled: false, filePath: 'C:\\exports\\safe.nnote' }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }, {
      requireById: () => meeting, listSpeakers: () => [], listTranscript: () => [], listSummarySections: () => [], listActionItems: () => [],
    })
    const result = await handlers.get('archive:export-meeting')!({}, 'meeting-1')
    expect(result).toMatchObject({ status: 'failure', code: 'EXPORT_FAILED' })
    expect(JSON.stringify(result)).not.toContain(secret)
  })
})
