import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, rm, unlink, type FileHandle } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type {
  WhisperModelErrorCode,
  WhisperModelId,
  WhisperModelProgress,
  WhisperModelStatus,
} from '../../shared/contracts/settings'
import { WHISPER_MODELS } from './whisperModelManifest'

const SAFE_MESSAGES: Record<WhisperModelErrorCode, string> = {
  WHISPER_MODEL_DIGEST_MISMATCH: 'Downloaded model verification failed.',
  WHISPER_MODEL_SIZE_MISMATCH: 'Downloaded model size did not match.',
  WHISPER_MODEL_INVALID_FILE: 'The model file is invalid.',
  WHISPER_MODEL_NOT_INSTALLED: 'The model is not installed.',
  WHISPER_MODEL_NETWORK_ERROR: 'The model download could not connect.',
  WHISPER_MODEL_HTTP_ERROR: 'The model server returned an unsupported response.',
  WHISPER_MODEL_RANGE_MISMATCH: 'The model download could not be resumed safely.',
  WHISPER_MODEL_STREAM_ERROR: 'The model download could not be saved.',
  WHISPER_MODEL_FILESYSTEM_ERROR: 'The model files could not be accessed.',
  WHISPER_MODEL_BUSY: 'The model is currently being changed.',
}

export class WhisperModelError extends Error {
  constructor(readonly code: WhisperModelErrorCode, message = SAFE_MESSAGES[code]) {
    super(message)
    this.name = 'WhisperModelError'
  }
}

export interface FileInspection {
  kind: 'missing' | 'regular' | 'symlink' | 'other'
  size: number
}

export interface WhisperModelStorage {
  ensureRoot(root: string): Promise<string | void>
  inspect(path: string): Promise<FileInspection>
  hash(path: string): Promise<string>
  remove(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  write(
    path: string,
    body: AsyncIterable<Uint8Array>,
    mode: 'append' | 'truncate',
    maximumBytes: number,
    onBytes: (bytes: number) => void,
  ): Promise<number>
}

async function* responseChunks(body: unknown): AsyncGenerator<Uint8Array> {
  if (body !== null && typeof body === 'object' && Symbol.asyncIterator in body) {
    yield* body as AsyncIterable<Uint8Array>
    return
  }
  const readable = body as ReadableStream<Uint8Array>
  const reader = readable.getReader()
  let completed = false
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) {
        completed = true
        return
      }
      yield item.value
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

async function cancelResponse(response: Response): Promise<void> {
  const body = response.body as unknown as { cancel?: () => Promise<void> } | null
  if (body?.cancel !== undefined) await body.cancel().catch(() => undefined)
}

type SecureFileOperation = 'hash' | 'append' | 'truncate' | 'remove'
type MutationOperation = 'truncate' | 'remove'
interface NodeWhisperModelStorageOptions {
  beforeOpen?: (path: string, operation: SecureFileOperation) => Promise<void> | void
  beforeMutation?: (path: string, operation: MutationOperation) => Promise<void> | void
}
interface OwnedRoot {
  path: string
  dev: bigint
  ino: bigint
}

function sameFileIdentity(
  left: { dev: bigint; ino: bigint },
  right: { dev: bigint; ino: bigint },
): boolean {
  // Windows reports dev=0 for path stats while FileHandle.stat() reports the volume ID.
  const sameDevice = left.dev === right.dev || (process.platform === 'win32' && (left.dev === 0n || right.dev === 0n))
  return sameDevice && left.ino === right.ino
}

export class NodeWhisperModelStorage implements WhisperModelStorage {
  private ownedRoot: OwnedRoot | null = null
  private rootHandle: FileHandle | null = null
  private readonly hashedIdentities = new Map<string, { dev: bigint; ino: bigint }>()

  constructor(private readonly options: NodeWhisperModelStorageOptions = {}) {}

  async close(): Promise<void> {
    const rootHandle = this.rootHandle
    this.rootHandle = null
    this.ownedRoot = null
    this.hashedIdentities.clear()
    if (rootHandle !== null) await rootHandle.close()
  }

  async ensureRoot(root: string): Promise<string> {
    const requested = resolve(root)
    await mkdir(requested, { recursive: true })
    const rootStat = await lstat(requested, { bigint: true })
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
    }
    const canonical = await realpath(requested)
    const canonicalStat = await lstat(canonical, { bigint: true })
    if (!canonicalStat.isDirectory() || canonicalStat.isSymbolicLink()) {
      throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
    }
    if (this.ownedRoot === null) {
      const directoryFlag = typeof fsConstants.O_DIRECTORY === 'number' ? fsConstants.O_DIRECTORY : 0
      const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
      const rootHandle = await open(canonical, fsConstants.O_RDONLY | directoryFlag | noFollow)
      const handleStat = await rootHandle.stat({ bigint: true })
      if (!handleStat.isDirectory() || !sameFileIdentity(handleStat, canonicalStat)) {
        await rootHandle.close()
        throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
      }
      this.rootHandle = rootHandle
      this.ownedRoot = { path: canonical, dev: handleStat.dev, ino: handleStat.ino }
    } else if (
      this.ownedRoot.path !== canonical
      || !sameFileIdentity(this.ownedRoot, canonicalStat)
    ) {
      throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
    }
    return canonical
  }

  async inspect(path: string): Promise<FileInspection> {
    await this.assertOwnedPath(path)
    try {
      const info = await lstat(path)
      if (info.isSymbolicLink()) return { kind: 'symlink', size: info.size }
      if (info.isFile()) return { kind: 'regular', size: info.size }
      return { kind: 'other', size: info.size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing', size: 0 }
      throw error
    }
  }

  async hash(path: string): Promise<string> {
    const opened = await this.openVerified(path, fsConstants.O_RDONLY, 'hash')
    if (opened === null) throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
    const { handle } = opened
    try {
      const hash = createHash('sha256')
      const buffer = Buffer.allocUnsafe(1024 * 1024)
      let position = 0
      while (true) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
        if (bytesRead === 0) {
          const verified = await this.revalidateOpenHandle(path, handle)
          this.hashedIdentities.set(resolve(path), verified)
          return hash.digest('hex')
        }
        hash.update(buffer.subarray(0, bytesRead))
        position += bytesRead
      }
    } finally {
      await handle.close()
    }
  }

  async remove(path: string): Promise<void> {
    await this.assertOwnedPath(path)
    let entry
    try {
      entry = await lstat(path, { bigint: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (entry.isSymbolicLink()) {
      await this.runBeforeMutation(path, 'remove')
      await this.assertOwnedPath(path)
      const current = await lstat(path, { bigint: true })
      if (!current.isSymbolicLink() || !sameFileIdentity(entry, current)) {
        throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
      }
      await unlink(path)
      this.hashedIdentities.delete(resolve(path))
      return
    }
    if (!entry.isFile() || entry.nlink !== 1n) {
      throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
    }
    const opened = await this.openVerified(path, fsConstants.O_RDONLY, 'remove', true)
    if (opened === null) return
    try {
      await this.runBeforeMutation(path, 'remove')
      await this.revalidateOpenHandle(path, opened.handle)
      await rm(path)
      this.hashedIdentities.delete(resolve(path))
    } finally {
      await opened.handle.close()
    }
  }

  async rename(from: string, to: string): Promise<void> {
    const source = resolve(from)
    const expected = this.hashedIdentities.get(source)
    if (expected === undefined) throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
    const opened = await this.openVerified(from, fsConstants.O_RDONLY, 'hash')
    if (opened === null || !sameFileIdentity(opened.identity, expected)) {
      if (opened !== null) await opened.handle.close()
      throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
    }
    try {
      await this.assertOwnedPath(to)
      await this.revalidateOpenHandle(from, opened.handle)
      await rename(from, to)
      const after = await lstat(to, { bigint: true })
      if (!after.isFile() || after.isSymbolicLink() || !sameFileIdentity(after, expected)) {
        throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
      }
    } catch (error) {
      const destination = await this.safeOwnedIdentity(to)
      if (destination !== null && sameFileIdentity(destination, expected)) {
        await this.remove(to).catch(() => undefined)
      }
      throw error
    } finally {
      this.hashedIdentities.delete(source)
      await opened.handle.close()
    }
  }

  async write(
    path: string,
    body: AsyncIterable<Uint8Array>,
    mode: 'append' | 'truncate',
    maximumBytes: number,
    onBytes: (bytes: number) => void,
  ): Promise<number> {
    const opened = mode === 'truncate'
      ? await this.openForTruncate(path)
      : await this.openVerified(path, fsConstants.O_WRONLY | fsConstants.O_APPEND, mode)
    if (opened === null) throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
    const { handle, size: existingSize } = opened
    const existing = mode === 'append' ? existingSize : 0
    let received = existing
    try {
      if (mode === 'truncate') {
        await this.runBeforeMutation(path, 'truncate')
        await this.revalidateOpenHandle(path, handle)
        await handle.truncate(0)
      }
      for await (const chunk of body) {
        received += chunk.byteLength
        if (received > maximumBytes) {
          throw new WhisperModelError('WHISPER_MODEL_SIZE_MISMATCH')
        }
        let offset = 0
        while (offset < chunk.byteLength) {
          const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset)
          if (bytesWritten === 0) throw new WhisperModelError('WHISPER_MODEL_STREAM_ERROR')
          offset += bytesWritten
        }
        onBytes(received)
      }
      await handle.sync()
      return received
    } finally {
      await handle.close()
    }
  }

  private async openVerified(
    path: string,
    flags: number,
    operation: SecureFileOperation,
    allowMissing = false,
  ): Promise<{ handle: FileHandle; size: number; identity: { dev: bigint; ino: bigint } } | null> {
    await this.assertOwnedPath(path)
    try {
      await this.options.beforeOpen?.(path, operation)
    } catch {
      throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
    }
    await this.assertOwnedPath(path)
    const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
    let handle: FileHandle
    try {
      handle = await open(path, flags | noFollow, 0o600)
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
    }
    try {
      const identity = await this.revalidateOpenHandle(path, handle)
      const handleStat = await handle.stat({ bigint: true })
      return { handle, size: Number(handleStat.size), identity }
    } catch (error) {
      await handle.close()
      throw error instanceof WhisperModelError
        ? error
        : new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
    }
  }

  private async openForTruncate(
    path: string,
  ): Promise<{ handle: FileHandle; size: number; identity: { dev: bigint; ino: bigint } }> {
    const existing = await this.openVerified(path, fsConstants.O_RDWR, 'truncate', true)
    if (existing !== null) return existing
    await this.assertOwnedPath(path)
    const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
    let handle: FileHandle
    try {
      handle = await open(
        path,
        fsConstants.O_RDWR | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
        0o600,
      )
    } catch {
      throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
    }
    try {
      const identity = await this.revalidateOpenHandle(path, handle)
      return { handle, size: 0, identity }
    } catch (error) {
      await handle.truncate(0).catch(() => undefined)
      await handle.close()
      throw error
    }
  }

  private async revalidateOpenHandle(
    path: string,
    handle: FileHandle,
  ): Promise<{ dev: bigint; ino: bigint }> {
    const handleStat = await handle.stat({ bigint: true })
    const pathStat = await lstat(path, { bigint: true })
    if (
      !handleStat.isFile()
      || !pathStat.isFile()
      || pathStat.isSymbolicLink()
      || handleStat.nlink !== 1n
      || pathStat.nlink !== 1n
      || !sameFileIdentity(handleStat, pathStat)
    ) {
      throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
    }
    const canonicalFile = await realpath(path)
    await this.assertOwnedPath(canonicalFile)
    await this.assertRootIdentity()
    return { dev: handleStat.dev, ino: handleStat.ino }
  }

  private async runBeforeMutation(path: string, operation: MutationOperation): Promise<void> {
    try {
      await this.options.beforeMutation?.(path, operation)
    } catch {
      throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
    }
  }

  private async safeOwnedIdentity(path: string): Promise<{ dev: bigint; ino: bigint } | null> {
    try {
      await this.assertOwnedPath(path)
      const info = await lstat(path, { bigint: true })
      return info.isFile() && !info.isSymbolicLink() ? { dev: info.dev, ino: info.ino } : null
    } catch {
      return null
    }
  }

  private async assertOwnedPath(path: string): Promise<void> {
    await this.assertRootIdentity()
    const root = this.ownedRoot
    if (root === null) throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
    const candidate = resolve(path)
    const fromRoot = relative(root.path, candidate)
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
      throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
    }
  }

  private async assertRootIdentity(): Promise<void> {
    const root = this.ownedRoot
    const rootHandle = this.rootHandle
    if (root === null || rootHandle === null) throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
    const handleStat = await rootHandle.stat({ bigint: true })
    const rootStat = await lstat(root.path, { bigint: true })
    if (
      !handleStat.isDirectory()
      || !rootStat.isDirectory()
      || rootStat.isSymbolicLink()
      || !sameFileIdentity(handleStat, root)
      || !sameFileIdentity(handleStat, rootStat)
      || await realpath(root.path) !== root.path
    ) {
      throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
    }
  }
}

type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>

interface ManagerDependencies {
  fetch?: Fetch
  storage?: WhisperModelStorage
}

export class WhisperModelManager {
  private readonly fetch: Fetch
  private readonly storage: WhisperModelStorage
  private readonly inFlight = new Map<WhisperModelId, Promise<WhisperModelStatus>>()
  private readonly listeners = new Set<(progress: WhisperModelProgress) => void>()
  private readonly progress = new Map<WhisperModelId, number>()

  constructor(private readonly requestedRoot: string, dependencies: ManagerDependencies = {}) {
    this.fetch = dependencies.fetch ?? globalThis.fetch
    this.storage = dependencies.storage ?? new NodeWhisperModelStorage()
  }

  async status(modelId: WhisperModelId): Promise<WhisperModelStatus> {
    try {
      return await this.statusUnchecked(modelId)
    } catch (error) {
      throw this.safeFilesystemError(error)
    }
  }

  private async statusUnchecked(modelId: WhisperModelId): Promise<WhisperModelStatus> {
    const { finalPath, partialPath, model } = await this.paths(modelId)
    const final = await this.storage.inspect(finalPath)
    if (final.kind !== 'missing') {
      if (final.kind !== 'regular' || final.size !== model.size) return this.corrupt(modelId, model.size, final.size)
      const digest = await this.storage.hash(finalPath)
      if (digest !== model.sha256) return this.corrupt(modelId, model.size, final.size)
      return { modelId, state: 'installed', expectedBytes: model.size, receivedBytes: model.size, error: null }
    }
    const partial = await this.storage.inspect(partialPath)
    const received = partial.kind === 'regular' ? Math.min(partial.size, model.size) : 0
    return {
      modelId,
      state: this.inFlight.has(modelId) ? 'downloading' : 'not_installed',
      expectedBytes: model.size,
      receivedBytes: this.progress.get(modelId) ?? received,
      error: null,
    }
  }

  async list(): Promise<WhisperModelStatus[]> {
    return Promise.all((Object.keys(WHISPER_MODELS) as WhisperModelId[]).map((id) => this.status(id)))
  }

  download(modelId: WhisperModelId): Promise<WhisperModelStatus> {
    const existing = this.inFlight.get(modelId)
    if (existing !== undefined) return existing
    const operation = this.downloadOnce(modelId).catch((error: unknown) => {
      throw this.safeFilesystemError(error)
    }).finally(() => {
      this.inFlight.delete(modelId)
      this.progress.delete(modelId)
    })
    this.inFlight.set(modelId, operation)
    return operation
  }

  async delete(modelId: WhisperModelId): Promise<WhisperModelStatus> {
    try {
      if (this.inFlight.has(modelId)) throw new WhisperModelError('WHISPER_MODEL_BUSY')
      const { finalPath, partialPath } = await this.paths(modelId)
      await this.storage.remove(finalPath)
      await this.storage.remove(partialPath)
      return this.statusUnchecked(modelId)
    } catch (error) {
      throw this.safeFilesystemError(error)
    }
  }

  onProgress(listener: (progress: WhisperModelProgress) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async verifiedPath(modelId: WhisperModelId): Promise<string> {
    try {
      const status = await this.statusUnchecked(modelId)
      if (status.state !== 'installed') throw new WhisperModelError('WHISPER_MODEL_NOT_INSTALLED')
      return (await this.paths(modelId)).finalPath
    } catch (error) {
      throw this.safeFilesystemError(error)
    }
  }

  private async downloadOnce(modelId: WhisperModelId): Promise<WhisperModelStatus> {
    const installed = await this.status(modelId)
    if (installed.state === 'installed') return installed
    const { finalPath, partialPath, model } = await this.paths(modelId)
    let partial = await this.storage.inspect(partialPath)
    if (partial.kind !== 'missing' && (partial.kind !== 'regular' || partial.size > model.size)) {
      await this.storage.remove(partialPath)
      partial = { kind: 'missing', size: 0 }
    }
    const start = partial.kind === 'regular' ? partial.size : 0
    this.emit(modelId, start, model.size)

    if (start === model.size) {
      const digest = await this.storage.hash(partialPath)
      if (digest !== model.sha256) {
        await this.storage.remove(partialPath)
        throw new WhisperModelError('WHISPER_MODEL_DIGEST_MISMATCH')
      }
      await this.storage.remove(finalPath)
      await this.storage.rename(partialPath, finalPath)
      return this.statusUnchecked(modelId)
    }

    let response: Response
    try {
      response = await this.fetch(model.url, start > 0 ? { headers: { Range: `bytes=${start}-` } } : undefined)
    } catch {
      throw new WhisperModelError('WHISPER_MODEL_NETWORK_ERROR')
    }
    if (response.body === null) {
      await this.storage.remove(partialPath)
      throw new WhisperModelError('WHISPER_MODEL_HTTP_ERROR')
    }

    let mode: 'append' | 'truncate'
    if (start === 0) {
      if (!response.ok || response.status === 206) {
        await cancelResponse(response)
        await this.storage.remove(partialPath)
        throw new WhisperModelError('WHISPER_MODEL_HTTP_ERROR')
      }
      mode = 'truncate'
    } else if (response.status === 200) {
      mode = 'truncate'
    } else if (response.status === 206 && this.validRange(response.headers.get('content-range'), start, model.size)) {
      mode = 'append'
    } else {
      await cancelResponse(response)
      await this.storage.remove(partialPath)
      throw new WhisperModelError('WHISPER_MODEL_RANGE_MISMATCH')
    }

    let received: number
    try {
      received = await this.storage.write(
        partialPath,
        responseChunks(response.body),
        mode,
        model.size,
        (bytes) => this.emit(modelId, bytes, model.size),
      )
    } catch (error) {
      if (error instanceof WhisperModelError) {
        if (error.code === 'WHISPER_MODEL_SIZE_MISMATCH') await this.storage.remove(partialPath)
        throw error
      }
      throw new WhisperModelError('WHISPER_MODEL_STREAM_ERROR')
    }
    if (received !== model.size) {
      await this.storage.remove(partialPath)
      throw new WhisperModelError('WHISPER_MODEL_SIZE_MISMATCH')
    }
    const digest = await this.storage.hash(partialPath)
    if (digest !== model.sha256) {
      await this.storage.remove(partialPath)
      throw new WhisperModelError('WHISPER_MODEL_DIGEST_MISMATCH')
    }
    await this.storage.remove(finalPath)
    await this.storage.rename(partialPath, finalPath)
    return this.statusUnchecked(modelId)
  }

  private async paths(modelId: WhisperModelId) {
    const model = WHISPER_MODELS[modelId]
    const canonicalRoot = resolve((await this.storage.ensureRoot(this.requestedRoot)) ?? this.requestedRoot)
    const finalPath = resolve(canonicalRoot, model.filename)
    const pathFromRoot = relative(canonicalRoot, finalPath)
    if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
      throw new WhisperModelError('WHISPER_MODEL_INVALID_FILE')
    }
    return { model, finalPath, partialPath: `${finalPath}.partial` }
  }

  private validRange(value: string | null, start: number, total: number): boolean {
    if (value === null) return false
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value)
    return match !== null
      && Number(match[1]) === start
      && Number(match[2]) === total - 1
      && Number(match[3]) === total
  }

  private emit(modelId: WhisperModelId, receivedBytes: number, totalBytes: number): void {
    const previous = this.progress.get(modelId) ?? -1
    if (receivedBytes < previous) return
    this.progress.set(modelId, receivedBytes)
    const progress = { modelId, receivedBytes, totalBytes }
    for (const listener of this.listeners) {
      try { listener(progress) } catch { /* an unavailable renderer must not break model I/O */ }
    }
  }

  private corrupt(modelId: WhisperModelId, expectedBytes: number, receivedBytes: number): WhisperModelStatus {
    return {
      modelId,
      state: 'corrupt',
      expectedBytes,
      receivedBytes,
      error: { code: 'WHISPER_MODEL_INVALID_FILE', message: SAFE_MESSAGES.WHISPER_MODEL_INVALID_FILE },
    }
  }

  private safeFilesystemError(error: unknown): WhisperModelError {
    return error instanceof WhisperModelError
      ? new WhisperModelError(error.code)
      : new WhisperModelError('WHISPER_MODEL_FILESYSTEM_ERROR')
  }
}
