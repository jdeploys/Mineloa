import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WhisperModelManager,
  WhisperModelError,
  type WhisperModelStorage,
} from '../../src/main/localModels/whisperModelManager'
import { WHISPER_MODELS } from '../../src/main/localModels/whisperModelManifest'
import { registerSettingsHandlers } from '../../src/main/ipc/registerSettingsHandlers'
import type { DesktopApi } from '../../src/shared/contracts/desktopApi'

type Entry = { kind: 'regular' | 'symlink' | 'other'; size: number; digest: string }

class MemoryStorage implements WhisperModelStorage {
  readonly entries = new Map<string, Entry>()
  readonly removed: string[] = []
  readonly renamed: Array<[string, string]> = []
  nextDigest: string = WHISPER_MODELS.base.sha256

  async ensureRoot(): Promise<void> {}
  async inspect(path: string) {
    const entry = this.entries.get(path)
    return entry === undefined ? { kind: 'missing' as const, size: 0 } : { kind: entry.kind, size: entry.size }
  }
  async hash(path: string): Promise<string> {
    const entry = this.entries.get(path)
    if (entry === undefined) throw new Error('missing')
    return entry.digest
  }
  async remove(path: string): Promise<void> {
    this.removed.push(path)
    this.entries.delete(path)
  }
  async rename(from: string, to: string): Promise<void> {
    const entry = this.entries.get(from)
    if (entry === undefined) throw new Error('missing')
    this.renamed.push([from, to])
    this.entries.set(to, entry)
    this.entries.delete(from)
  }
  async write(
    path: string,
    body: AsyncIterable<Uint8Array>,
    mode: 'append' | 'truncate',
    maximumBytes: number,
    onBytes: (bytes: number) => void,
  ): Promise<number> {
    let size = mode === 'append' ? (this.entries.get(path)?.size ?? 0) : 0
    for await (const chunk of body) {
      size += chunk.byteLength
      if (size > maximumBytes) throw new WhisperModelError('WHISPER_MODEL_SIZE_MISMATCH', 'Model download size did not match.')
      onBytes(size)
    }
    this.entries.set(path, { kind: 'regular', size, digest: this.nextDigest })
    return size
  }
}

function chunk(size: number): Uint8Array {
  return { byteLength: size } as Uint8Array
}

function response(status: number, sizes: number[], headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    body: (async function* () { for (const size of sizes) yield chunk(size) })(),
  } as unknown as Response
}

function setup(modelId: 'base' | 'small' = 'base') {
  const root = 'C:\\owned\\models'
  const storage = new MemoryStorage()
  storage.nextDigest = WHISPER_MODELS[modelId].sha256
  const fetch = vi.fn().mockResolvedValue(response(200, [WHISPER_MODELS[modelId].size]))
  const manager = new WhisperModelManager(root, { fetch, storage })
  const finalPath = join(root, WHISPER_MODELS[modelId].filename)
  const partialPath = `${finalPath}.partial`
  return { root, storage, fetch, manager, finalPath, partialPath }
}

describe('WhisperModelManager', () => {
  it('activates only after exact pinned size and digest via atomic partial rename', async () => {
    const { manager, storage, finalPath, partialPath } = setup()

    await expect(manager.download('base')).resolves.toMatchObject({ modelId: 'base', state: 'installed' })
    expect(storage.renamed).toEqual([[partialPath, finalPath]])
    await expect(manager.status('base')).resolves.toMatchObject({ state: 'installed' })
  })

  it.each([
    ['digest', 'WHISPER_MODEL_DIGEST_MISMATCH'],
    ['size', 'WHISPER_MODEL_SIZE_MISMATCH'],
  ] as const)('removes a %s-mismatched partial and never installs it', async (kind, code) => {
    const { manager, storage, partialPath } = setup()
    if (kind === 'digest') storage.nextDigest = '0'.repeat(64)
    else storage.write = async (path) => {
      storage.entries.set(path, { kind: 'regular', size: WHISPER_MODELS.base.size - 1, digest: WHISPER_MODELS.base.sha256 })
      return WHISPER_MODELS.base.size - 1
    }

    await expect(manager.download('base')).rejects.toMatchObject({ code })
    expect(storage.removed).toContain(partialPath)
    await expect(manager.status('base')).resolves.toMatchObject({ state: 'not_installed' })
  })

  it('cancels the response stream as soon as it exceeds the pinned size', async () => {
    const context = setup()
    const cancel = vi.fn().mockResolvedValue(undefined)
    let delivered = false
    context.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: async () => delivered
            ? { done: true, value: undefined }
            : (delivered = true, { done: false, value: chunk(WHISPER_MODELS.base.size + 1) }),
          cancel,
          releaseLock: vi.fn(),
        }),
      },
    } as unknown as Response)

    await expect(context.manager.download('base')).rejects.toMatchObject({ code: 'WHISPER_MODEL_SIZE_MISMATCH' })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['symlink', 'symlink', WHISPER_MODELS.base.size, WHISPER_MODELS.base.sha256],
    ['non-regular', 'other', WHISPER_MODELS.base.size, WHISPER_MODELS.base.sha256],
    ['wrong size', 'regular', 10, WHISPER_MODELS.base.sha256],
    ['wrong digest', 'regular', WHISPER_MODELS.base.size, '0'.repeat(64)],
  ] as const)('reports a %s final file as corrupt', async (_label, kind, size, digest) => {
    const { manager, storage, finalPath } = setup()
    storage.entries.set(finalPath, { kind, size, digest })
    await expect(manager.status('base')).resolves.toMatchObject({ state: 'corrupt' })
  })

  it('resumes only from a matching 206 Content-Range and emits monotonic safe progress', async () => {
    const { manager, storage, fetch, partialPath } = setup()
    const start = 100
    storage.entries.set(partialPath, { kind: 'regular', size: start, digest: '' })
    fetch.mockResolvedValue(response(206, [200, WHISPER_MODELS.base.size - start - 200], {
      'content-range': `bytes ${start}-${WHISPER_MODELS.base.size - 1}/${WHISPER_MODELS.base.size}`,
    }))
    const progress: unknown[] = []
    manager.onProgress((value) => progress.push(value))

    await manager.download('base')

    expect(fetch).toHaveBeenCalledWith(WHISPER_MODELS.base.url, { headers: { Range: `bytes=${start}-` } })
    expect(progress).toEqual([
      { modelId: 'base', receivedBytes: start, totalBytes: WHISPER_MODELS.base.size },
      { modelId: 'base', receivedBytes: start + 200, totalBytes: WHISPER_MODELS.base.size },
      { modelId: 'base', receivedBytes: WHISPER_MODELS.base.size, totalBytes: WHISPER_MODELS.base.size },
    ])
    expect(JSON.stringify(progress)).not.toContain('owned')
    expect(JSON.stringify(progress)).not.toContain('huggingface')
  })

  it('isolates a throwing progress listener from downloads and other listeners', async () => {
    const { manager } = setup()
    const healthy = vi.fn()
    manager.onProgress(() => { throw new Error('renderer disposed') })
    manager.onProgress(healthy)

    await expect(manager.download('base')).resolves.toMatchObject({ state: 'installed' })
    expect(healthy).toHaveBeenCalled()
  })

  it('verifies and atomically activates a complete partial without another HTTP request', async () => {
    const { manager, storage, fetch, partialPath, finalPath } = setup()
    storage.entries.set(partialPath, {
      kind: 'regular', size: WHISPER_MODELS.base.size, digest: WHISPER_MODELS.base.sha256,
    })

    await expect(manager.download('base')).resolves.toMatchObject({ state: 'installed' })
    expect(fetch).not.toHaveBeenCalled()
    expect(storage.renamed).toEqual([[partialPath, finalPath]])
  })

  it('maps unexpected filesystem errors to a stable safe error without leaking paths', async () => {
    const { manager, storage } = setup()
    storage.inspect = async () => { throw new Error('C:\\private\\username\\models failed') }

    const failure = await manager.status('base').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(WhisperModelError)
    expect(failure).toMatchObject({ code: 'WHISPER_MODEL_FILESYSTEM_ERROR' })
    expect(String((failure as Error).message)).not.toMatch(/private|username|models/i)
  })

  it('restarts from zero when a range request is ignored with 200', async () => {
    const { manager, storage, fetch, partialPath } = setup()
    storage.entries.set(partialPath, { kind: 'regular', size: 100, digest: '' })

    await manager.download('base')

    expect(fetch).toHaveBeenCalledWith(WHISPER_MODELS.base.url, { headers: { Range: 'bytes=100-' } })
    expect(storage.entries.get(partialPath)).toBeUndefined()
  })

  it.each([
    ['inconsistent range', async ({ fetch }: ReturnType<typeof setup>) => fetch.mockResolvedValue(response(206, [1], { 'content-range': 'bytes 99-99/147951465' }))],
    ['network failure', async ({ fetch }: ReturnType<typeof setup>) => fetch.mockRejectedValue(new Error('private endpoint failed'))],
    ['stream failure', async ({ fetch }: ReturnType<typeof setup>) => fetch.mockResolvedValue({ status: 200, ok: true, headers: new Headers(), body: (async function* () { throw new Error('disk path secret') })() } as unknown as Response)],
    ['overflow', async ({ fetch }: ReturnType<typeof setup>) => fetch.mockResolvedValue(response(200, [WHISPER_MODELS.base.size + 1]))],
  ] as const)('%s leaves no installed state and exposes only a safe model error', async (_label, arrange) => {
    const context = setup()
    if (_label === 'inconsistent range') context.storage.entries.set(context.partialPath, { kind: 'regular', size: 100, digest: '' })
    await arrange(context)

    const failure = await context.manager.download('base').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(WhisperModelError)
    expect(failure).toMatchObject({ code: expect.stringMatching(/^WHISPER_MODEL_/) })
    expect(String((failure as Error).message)).not.toMatch(/private endpoint|disk path|huggingface|owned/i)
    await expect(context.manager.status('base')).resolves.not.toMatchObject({ state: 'installed' })
  })

  it('shares the same-model in-flight download without double-writing', async () => {
    const context = setup()
    let release!: () => void
    context.fetch.mockImplementation(() => new Promise<Response>((resolve) => { release = () => resolve(response(200, [WHISPER_MODELS.base.size])) }))

    const first = context.manager.download('base')
    const second = context.manager.download('base')
    await vi.waitFor(() => expect(context.fetch).toHaveBeenCalledTimes(1))
    release()
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(context.fetch).toHaveBeenCalledTimes(1)
    expect(context.storage.renamed).toHaveLength(1)
  })

  it('deletes only the manifest-owned final and partial files', async () => {
    const { manager, storage, root, finalPath, partialPath } = setup()
    const unrelated = join(root, 'notes.txt')
    for (const path of [finalPath, partialPath, unrelated]) storage.entries.set(path, { kind: 'regular', size: 1, digest: '' })

    await manager.delete('base')

    expect(storage.removed).toEqual([finalPath, partialPath])
    expect(storage.entries.has(unrelated)).toBe(true)
  })

  it('verifiedPath rechecks trust on every call and never exposes an invalid file path', async () => {
    const { manager, storage, finalPath } = setup()
    storage.entries.set(finalPath, { kind: 'regular', size: WHISPER_MODELS.base.size, digest: WHISPER_MODELS.base.sha256 })
    await expect(manager.verifiedPath('base')).resolves.toBe(finalPath)

    storage.entries.set(finalPath, { kind: 'symlink', size: WHISPER_MODELS.base.size, digest: WHISPER_MODELS.base.sha256 })
    await expect(manager.verifiedPath('base')).rejects.toMatchObject({ code: 'WHISPER_MODEL_NOT_INSTALLED' })
  })
})

describe('Whisper model settings IPC and preload', () => {
  beforeEach(() => vi.resetModules())

  it('parses model IDs in every lifecycle handler while preserving API-key/provider contracts', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    let progressListener!: (progress: { modelId: 'base'; receivedBytes: number; totalBytes: number }) => void
    const publish = vi.fn()
    const descriptors = vi.fn().mockResolvedValue([])
    const models = {
      list: vi.fn().mockResolvedValue([]), download: vi.fn(), delete: vi.fn(),
      onProgress: vi.fn((listener) => { progressListener = listener; return () => undefined }),
    }
    registerSettingsHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      { get: async () => null, set: async () => undefined, delete: async () => undefined },
      { validate: async () => undefined },
      { get: () => ({ transcriptionProvider: 'openai', summaryProvider: 'openai', localWhisperModel: 'base' }), update: (input) => input },
      { descriptors },
      models,
      publish,
    )

    await expect(handlers.get('settings:download-whisper-model')?.({}, 'large')).rejects.toThrow()
    expect(models.download).not.toHaveBeenCalled()
    await handlers.get('settings:delete-whisper-model')?.({}, 'small')
    expect(models.delete).toHaveBeenCalledWith('small')
    expect(descriptors).not.toHaveBeenCalled()
    await expect(handlers.get('settings:get-api-key-status')?.({})).resolves.toEqual({ configured: false, lastValidatedAt: null })
    await expect(handlers.get('settings:get-processing-providers')?.({})).resolves.toMatchObject({ transcriptionProvider: 'openai' })
    expect(handlers.has('settings:list-processing-provider-descriptors')).toBe(true)
    progressListener({ modelId: 'base', receivedBytes: 10, totalBytes: WHISPER_MODELS.base.size })
    expect(publish).toHaveBeenCalledWith({ modelId: 'base', receivedBytes: 10, totalBytes: WHISPER_MODELS.base.size })
  })

  it('validates statuses/progress and removes the exact preload listener', async () => {
    let exposed!: DesktopApi
    let progressHandler!: (event: unknown, value: unknown) => void
    const removeListener = vi.fn()
    const invoke = vi.fn().mockResolvedValue([{ modelId: 'base', state: 'installed', expectedBytes: WHISPER_MODELS.base.size, receivedBytes: WHISPER_MODELS.base.size, error: null }])
    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld: (_name: string, api: DesktopApi) => { exposed = api } },
      ipcRenderer: {
        invoke,
        on: vi.fn((_channel: string, handler: typeof progressHandler) => { progressHandler = handler }),
        removeListener,
      },
    }))
    await import('../../src/preload/index')

    await expect(exposed.settings.listWhisperModels()).resolves.toHaveLength(1)
    invoke.mockResolvedValueOnce({ modelId: 'small', state: 'not_installed', expectedBytes: WHISPER_MODELS.small.size, receivedBytes: 0, error: null })
    await expect(exposed.settings.downloadWhisperModel('small')).resolves.toMatchObject({ modelId: 'small' })
    invoke.mockResolvedValueOnce({ modelId: 'small', state: 'not_installed', expectedBytes: WHISPER_MODELS.small.size, receivedBytes: 0, error: { code: 'raw', message: 'bad' } })
    await expect(exposed.settings.deleteWhisperModel('small')).rejects.toThrow()
    await expect(exposed.settings.downloadWhisperModel('large' as never)).rejects.toThrow()
    const listener = vi.fn()
    const unsubscribe = exposed.settings.onWhisperModelProgress(listener)
    progressHandler({}, { modelId: 'base', receivedBytes: 1, totalBytes: WHISPER_MODELS.base.size })
    progressHandler({}, { modelId: 'large', receivedBytes: 2, totalBytes: 3 })
    progressHandler({}, { modelId: 'base', receivedBytes: 4, totalBytes: 3 })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    expect(removeListener).toHaveBeenCalledWith('settings:whisper-model-progress', progressHandler)

    invoke.mockResolvedValueOnce([{ modelId: 'base', state: 'installed', expectedBytes: 1, receivedBytes: 1, localPath: 'secret' }])
    await expect(exposed.settings.listWhisperModels()).rejects.toThrow()
  })
})
