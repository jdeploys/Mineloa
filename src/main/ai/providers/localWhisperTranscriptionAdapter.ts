import { lstat, mkdtemp, open, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { WhisperModelId } from '../../../shared/contracts/settings'
import type { LocalRuntimePaths } from '../../localRuntime/runtimePaths'
import { parseWhisperOutput } from '../../localRuntime/whisperOutput'
import type { OwnedProcessRequest, OwnedProcessResult } from '../../process/runOwnedProcess'
import { ProviderError, safeProviderError } from './providerErrors'
import type {
  NormalizedTranscription, ProviderAvailability, ProviderDescriptor,
  TranscriptionProvider, TranscriptionProviderRequest,
} from './providerPorts'

// A two-hour meeting can produce several MiB of timestamp-rich JSON even when
// the spoken text is modest. Keep a hard bound while leaving room for metadata.
const OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024

interface Dependencies {
  resolveRuntimePaths(): Promise<LocalRuntimePaths>
  verifiedModelPath(model: WhisperModelId): Promise<string>
  resolveModel(): WhisperModelId
  recordingsRoot: string
  temporaryRoot: string
  runProcess(request: OwnedProcessRequest): Promise<OwnedProcessResult>
  removeTemporaryDirectory?: (path: string) => Promise<void>
}

function safeError(code: string, message: string, retryable = false): ProviderError {
  return safeProviderError(code, message, retryable)
}

function isWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot)
}

async function trustedInput(recordingsRoot: string, requested: string): Promise<string> {
  try {
    const root = await realpath(recordingsRoot)
    const requestedAbsolute = resolve(requested)
    if (!isWithin(root, requestedAbsolute)) throw new Error()
    const details = await lstat(requestedAbsolute)
    if (!details.isFile() || details.isSymbolicLink()) throw new Error()
    const canonical = await realpath(requestedAbsolute)
    if (!isWithin(root, canonical)) throw new Error()
    return canonical
  } catch {
    throw safeError('LOCAL_WHISPER_INVALID_INPUT', 'Local Whisper could not process this audio file.')
  }
}

async function trustedTemporaryRoot(requested: string): Promise<string> {
  try {
    const details = await lstat(requested)
    if (!details.isDirectory() || details.isSymbolicLink()) throw new Error()
    return await realpath(requested)
  } catch {
    throw safeError('LOCAL_WHISPER_FILESYSTEM_ERROR', 'Local Whisper temporary files could not be created.')
  }
}

function assertProcess(result: OwnedProcessResult): void {
  if (result.status === 'success') return
  if (result.status === 'timeout') throw safeError('LOCAL_WHISPER_TIMEOUT', 'Local Whisper timed out. Try again.', true)
  if (result.status === 'cancelled') throw safeError('LOCAL_WHISPER_CANCELLED', 'Local Whisper was cancelled.', true)
  if (result.status === 'output_overflow') throw safeError('LOCAL_WHISPER_PROCESS_OUTPUT_TOO_LARGE', 'Local Whisper produced too much diagnostic output.')
  if (result.status === 'spawn_error') throw safeError('LOCAL_WHISPER_RUNTIME_UNAVAILABLE', 'Local Whisper runtime is unavailable.')
  throw safeError('LOCAL_WHISPER_PROCESS_FAILED', 'Local Whisper processing failed.', true)
}

async function readBounded(path: string): Promise<string> {
  let handle
  try {
    handle = await open(path, 'r')
    const details = await handle.stat()
    if (!details.isFile()) throw safeError('LOCAL_WHISPER_INVALID_OUTPUT', 'Local Whisper returned an invalid transcription.')
    if (details.size > OUTPUT_LIMIT_BYTES) throw safeError('LOCAL_WHISPER_OUTPUT_TOO_LARGE', 'Local Whisper transcription output was too large.')
    const bytes = Buffer.alloc(Number(details.size) + 1)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    if (bytesRead > OUTPUT_LIMIT_BYTES || bytesRead !== details.size) {
      throw safeError('LOCAL_WHISPER_OUTPUT_TOO_LARGE', 'Local Whisper transcription output was too large.')
    }
    return bytes.subarray(0, bytesRead).toString('utf8')
  } catch (error) {
    if (error instanceof ProviderError) throw error
    throw safeError('LOCAL_WHISPER_INVALID_OUTPUT', 'Local Whisper returned an invalid transcription.')
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function pcmDuration(path: string): Promise<number> {
  let handle
  try {
    handle = await open(path, 'r')
    const header = Buffer.alloc(64 * 1024)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    const data = header.subarray(0, bytesRead)
    if (data.length < 12 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') throw new Error()
    let offset = 12
    let bytesPerSecond: number | null = null
    let dataBytes: number | null = null
    while (offset + 8 <= data.length) {
      const id = data.toString('ascii', offset, offset + 4)
      const size = data.readUInt32LE(offset + 4)
      const content = offset + 8
      if (id === 'fmt ' && size >= 16 && content + 16 <= data.length) bytesPerSecond = data.readUInt32LE(content + 8)
      if (id === 'data') { dataBytes = size; break }
      offset = content + size + (size % 2)
    }
    const duration = dataBytes !== null && bytesPerSecond !== null && bytesPerSecond > 0 ? dataBytes / bytesPerSecond : Number.NaN
    if (!Number.isFinite(duration) || duration < 0) throw new Error()
    return duration
  } catch {
    throw safeError('LOCAL_WHISPER_INVALID_OUTPUT', 'Local Whisper returned an invalid transcription.')
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function normalizedDuration(requested: number | undefined, wavDuration: number): number {
  const duration = requested ?? wavDuration
  if (!Number.isFinite(duration) || duration < 0) throw safeError('LOCAL_WHISPER_INVALID_OUTPUT', 'Local Whisper returned an invalid transcription.')
  return duration
}

export class LocalWhisperTranscriptionAdapter implements TranscriptionProvider {
  readonly id = 'local_whisper' as const
  private readonly removeTemporaryDirectory: (path: string) => Promise<void>

  constructor(private readonly dependencies: Dependencies) {
    this.removeTemporaryDirectory = dependencies.removeTemporaryDirectory
      ?? ((path) => rm(path, { recursive: true, force: true }))
  }

  async availability(): Promise<ProviderAvailability> {
    try {
      await this.dependencies.resolveRuntimePaths()
    } catch {
      return { available: false, code: 'LOCAL_WHISPER_RUNTIME_UNAVAILABLE', message: 'Local Whisper runtime is unavailable.' }
    }
    try {
      await this.dependencies.verifiedModelPath(this.dependencies.resolveModel())
      return { available: true, code: null, message: null }
    } catch {
      return { available: false, code: 'LOCAL_WHISPER_MODEL_UNAVAILABLE', message: 'The selected Local Whisper model is unavailable.' }
    }
  }

  async descriptor(): Promise<ProviderDescriptor> {
    return {
      id: this.id, stage: 'transcription', displayName: 'Local Whisper',
      availability: await this.availability(), privacy: 'local', capabilities: ['model_manager'],
    }
  }

  async transcribe(request: TranscriptionProviderRequest): Promise<NormalizedTranscription> {
    let temporaryDirectory: string | null = null
    let primary: unknown = null
    try {
      const input = await trustedInput(this.dependencies.recordingsRoot, request.filePath)
      let runtime: LocalRuntimePaths
      try { runtime = await this.dependencies.resolveRuntimePaths() } catch {
        throw safeError('LOCAL_WHISPER_RUNTIME_UNAVAILABLE', 'Local Whisper runtime is unavailable.')
      }
      let model: string
      try { model = await this.dependencies.verifiedModelPath(this.dependencies.resolveModel()) } catch {
        throw safeError('LOCAL_WHISPER_MODEL_UNAVAILABLE', 'The selected Local Whisper model is unavailable.')
      }
      try {
        const temporaryRoot = await trustedTemporaryRoot(this.dependencies.temporaryRoot)
        temporaryDirectory = await mkdtemp(join(temporaryRoot, 'nnote-whisper-'))
      } catch {
        throw safeError('LOCAL_WHISPER_FILESYSTEM_ERROR', 'Local Whisper temporary files could not be created.')
      }
      const wav = join(temporaryDirectory, 'input.wav')
      const outputBase = join(temporaryDirectory, 'transcript')
      assertProcess(await this.dependencies.runProcess({
        command: runtime.ffmpegPath, cwd: temporaryDirectory,
        args: ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', input, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', wav],
      }))
      const measuredDuration = await pcmDuration(wav)
      assertProcess(await this.dependencies.runProcess({
        command: runtime.whisperPath, cwd: temporaryDirectory,
        args: ['-m', model, '-f', wav, '-l', 'ko', '-oj', '-of', outputBase],
      }))
      const durationSeconds = normalizedDuration(request.recordingDurationSeconds, measuredDuration)
      return parseWhisperOutput(await readBounded(`${outputBase}.json`), durationSeconds)
    } catch (error) {
      primary = error
      if (error instanceof ProviderError) throw error
      throw safeError('LOCAL_WHISPER_INVALID_OUTPUT', 'Local Whisper returned an invalid transcription.')
    } finally {
      if (temporaryDirectory !== null) {
        try { await this.removeTemporaryDirectory(temporaryDirectory) } catch {
          if (primary === null) throw safeError('LOCAL_WHISPER_CLEANUP_FAILED', 'Local Whisper temporary files could not be removed.')
        }
      }
    }
  }
}
