import { describe, expect, it, vi } from 'vitest'
import { publishWhisperProgressToLiveWindows } from '../../src/main/window/publishWhisperProgress'

const progress = { modelId: 'base' as const, receivedBytes: 1, totalBytes: 10 }

describe('Whisper model progress forwarding', () => {
  it('sends progress only to a live window with live webContents', () => {
    const send = vi.fn()
    publishWhisperProgressToLiveWindows([
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } },
    ], progress)
    expect(send).toHaveBeenCalledWith('settings:whisper-model-progress', progress)
  })

  it('skips destroyed windows and destroyed webContents', () => {
    const destroyedWindowSend = vi.fn()
    const destroyedContentsSend = vi.fn()
    publishWhisperProgressToLiveWindows([
      { isDestroyed: () => true, webContents: { isDestroyed: () => false, send: destroyedWindowSend } },
      { isDestroyed: () => false, webContents: { isDestroyed: () => true, send: destroyedContentsSend } },
    ], progress)
    expect(destroyedWindowSend).not.toHaveBeenCalled()
    expect(destroyedContentsSend).not.toHaveBeenCalled()
  })

  it('continues to other live windows when one send races with destruction', () => {
    const healthySend = vi.fn()
    publishWhisperProgressToLiveWindows([
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: () => { throw new Error('destroyed') } } },
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: healthySend } },
    ], progress)
    expect(healthySend).toHaveBeenCalledWith('settings:whisper-model-progress', progress)
  })

  it.each(['isDestroyed', 'webContents getter', 'webContents isDestroyed'])(
    'continues after a window throws from %s',
    (failurePoint) => {
      const healthySend = vi.fn()
      const failingWindow = failurePoint === 'isDestroyed'
        ? { isDestroyed: () => { throw new Error('destroyed race') }, webContents: {} }
        : failurePoint === 'webContents getter'
          ? Object.defineProperty({ isDestroyed: () => false }, 'webContents', {
            get: () => { throw new Error('getter race') },
          })
          : {
            isDestroyed: () => false,
            webContents: { isDestroyed: () => { throw new Error('contents race') }, send: vi.fn() },
          }

      publishWhisperProgressToLiveWindows([
        failingWindow as never,
        { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: healthySend } },
      ], progress)
      expect(healthySend).toHaveBeenCalledWith('settings:whisper-model-progress', progress)
    },
  )

  it('reads webContents only once for a live window', () => {
    const send = vi.fn()
    const getWebContents = vi.fn(() => ({ isDestroyed: () => false, send }))
    const window = Object.defineProperty({ isDestroyed: () => false }, 'webContents', {
      get: getWebContents,
    })

    publishWhisperProgressToLiveWindows([window as never], progress)

    expect(getWebContents).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('settings:whisper-model-progress', progress)
  })
})
