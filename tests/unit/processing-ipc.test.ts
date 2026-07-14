import { describe, expect, it, vi } from 'vitest'
import { registerProcessingHandlers } from '../../src/main/ipc/registerProcessingHandlers'

function harness() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const sends: unknown[][] = []
  const progress = { meetingId: 'meeting-1', state: 'transcribing', failedStage: null, retryable: false, audioRequired: true, error: null }
  const service = { process: vi.fn(), retry: vi.fn(), getStatus: vi.fn(() => ({ ...progress, state: 'recorded' })), subscribe: vi.fn((listener) => { listener(progress); return () => undefined }) }
  registerProcessingHandlers({ handle: (channel, listener) => handlers.set(channel, listener) }, service as never, { getAllWindows: () => [{ webContents: { isDestroyed: () => false, send: (...args: unknown[]) => sends.push(args) } }] })
  return { handlers, service, sends }
}

describe('processing IPC', () => {
  it('validates meeting ids and exposes only typed processing actions', async () => {
    const { handlers, service } = harness()
    await handlers.get('processing:process')!({}, 'meeting-1')
    expect(service.process).toHaveBeenCalledWith('meeting-1')
    await expect(Promise.resolve().then(() => handlers.get('processing:retry')!({}, '../secret'))).rejects.toThrow()
    expect(service.retry).not.toHaveBeenCalled()
  })

  it('forwards scoped progress on the fixed channel', () => {
    const { sends } = harness()
    expect(sends).toHaveLength(1)
    expect(sends[0]).toEqual(['processing:progress', expect.objectContaining({ meetingId: 'meeting-1', state: 'transcribing' })])
  })
})
