import { lstat, readdir, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { MeetingRepository, ProcessingStage } from '../db/meetingRepository'
import { recordingFilePrefix } from '../recording/recordingPaths'
import type { ProcessingStatus } from '../../shared/contracts/processing'

interface TranscriptionPort { transcribeMeeting(meetingId: string): Promise<unknown> }
interface SummaryPort { summarizeMeeting(meetingId: string): Promise<unknown> }
interface FilePort { remove(path: string): Promise<void> }

export class ProcessingAlreadyRunningError extends Error {
  readonly code = 'PROCESSING_ALREADY_RUNNING'
  constructor() { super('Processing is already running for this meeting') }
}

type Listener = (status: ProcessingStatus) => void

function safeFailure(error: unknown): { code: string; message: string; retryable: boolean } {
  if (typeof error === 'object' && error !== null) {
    const value = error as { code?: unknown; message?: unknown; retryable?: unknown }
    if (typeof value.code === 'string' && typeof value.message === 'string' && typeof value.retryable === 'boolean') {
      return { code: value.code.slice(0, 100), message: value.message.slice(0, 500), retryable: value.retryable }
    }
  }
  return { code: 'PROCESSING_FAILED', message: 'Processing failed. Try again.', retryable: true }
}

export class ProcessingService {
  private readonly active = new Set<string>()
  private readonly listeners = new Set<Listener>()

  constructor(
    private readonly meetings: MeetingRepository,
    private readonly transcription: TranscriptionPort,
    private readonly summary: SummaryPort,
    private readonly recordingsDirectory: string,
    private readonly files: FilePort = { remove: (path) => rm(path, { force: true }) },
  ) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getStatus(meetingId: string): ProcessingStatus {
    const meeting = this.meetings.requireById(meetingId)
    const attempt = this.meetings.latestProcessingAttempt(meetingId)
    if (attempt?.stage === 'cleanup' && attempt.succeeded !== true) {
      const error = attempt.error ?? { code: 'AUDIO_CLEANUP_INTERRUPTED', message: 'Audio cleanup was interrupted.', retryable: true }
      return { meetingId, state: 'cleanup_failed', failedStage: 'cleanup', retryable: true, audioRequired: false, error: { code: error.code, message: error.message } }
    }
    if (meeting.status === 'failed') {
      const stage = attempt?.stage === 'summarizing' ? 'summarizing' : 'transcribing'
      const error = attempt?.error ?? { code: 'PROCESSING_FAILED', message: 'Processing failed. Try again.', retryable: true }
      return { meetingId, state: 'failed', failedStage: stage, retryable: error.retryable, audioRequired: stage === 'transcribing', error: { code: error.code, message: error.message } }
    }
    if (meeting.status === 'transcribing' || meeting.status === 'summarizing') {
      return { meetingId, state: meeting.status, failedStage: null, retryable: false, audioRequired: meeting.status === 'transcribing', error: null }
    }
    if (meeting.status === 'completed') {
      return { meetingId, state: 'completed', failedStage: null, retryable: false, audioRequired: false, error: null }
    }
    return { meetingId, state: 'recorded', failedStage: null, retryable: false, audioRequired: true, error: null }
  }

  async process(meetingId: string): Promise<ProcessingStatus> {
    return this.lock(meetingId, async () => {
      const meeting = this.meetings.requireById(meetingId)
      if (meeting.status !== 'recorded') throw new Error('Only a recorded meeting can start processing')
      await this.runStage(meetingId, 'transcribing', () => this.meetings.beginTranscription(meetingId), () => this.transcription.transcribeMeeting(meetingId))
      await this.runStage(meetingId, 'summarizing', undefined, () => this.summary.summarizeMeeting(meetingId))
      await this.applyRetention(meetingId)
      return this.getStatus(meetingId)
    })
  }

  async retry(meetingId: string): Promise<ProcessingStatus> {
    return this.lock(meetingId, async () => {
      const status = this.getStatus(meetingId)
      if (!status.retryable || status.failedStage === null) throw new Error('This processing stage cannot be retried')
      if (status.failedStage === 'cleanup') {
        await this.applyRetention(meetingId)
      } else if (status.failedStage === 'summarizing') {
        await this.runStage(meetingId, 'summarizing', () => this.meetings.beginSummarization(meetingId), () => this.summary.summarizeMeeting(meetingId))
        await this.applyRetention(meetingId)
      } else {
        await this.runStage(meetingId, 'transcribing', () => this.meetings.beginTranscription(meetingId), () => this.transcription.transcribeMeeting(meetingId))
        await this.runStage(meetingId, 'summarizing', undefined, () => this.summary.summarizeMeeting(meetingId))
        await this.applyRetention(meetingId)
      }
      return this.getStatus(meetingId)
    })
  }

  private async lock<T>(meetingId: string, operation: () => Promise<T>): Promise<T> {
    if (this.active.has(meetingId)) throw new ProcessingAlreadyRunningError()
    this.active.add(meetingId)
    try { return await operation() } finally { this.active.delete(meetingId) }
  }

  private async runStage(
    meetingId: string,
    stage: Exclude<ProcessingStage, 'cleanup'>,
    prepare: (() => unknown) | undefined,
    request: () => Promise<unknown>,
  ): Promise<void> {
    const attempt = this.meetings.beginProcessingAttempt(meetingId, stage)
    try {
      prepare?.()
      this.emit(this.getStatus(meetingId))
      await request()
    } catch (error) {
      const failure = safeFailure(error)
      this.meetings.failProcessing(meetingId)
      this.meetings.finishProcessingAttempt(attempt.id, { succeeded: false, error: failure })
      this.emit(this.getStatus(meetingId))
      throw error
    }
    this.meetings.finishProcessingAttempt(attempt.id, { succeeded: true })
    this.emit(this.getStatus(meetingId))
  }

  private async applyRetention(meetingId: string): Promise<void> {
    const meeting = this.meetings.requireById(meetingId)
    if (meeting.status !== 'completed' || meeting.audioPolicy === 'keep' || meeting.audioPath === null) return
    const attempt = this.meetings.beginProcessingAttempt(meetingId, 'cleanup')
    try {
      for (const path of await this.trustedAudioPaths(meetingId)) await this.files.remove(path)
      this.meetings.completeAudioCleanup(meetingId, attempt.id)
      this.emit(this.getStatus(meetingId))
    } catch (error) {
      const failure = { code: 'AUDIO_CLEANUP_FAILED', message: 'The saved audio could not be deleted. Try again.', retryable: true }
      this.meetings.finishProcessingAttempt(attempt.id, { succeeded: false, error: failure })
      this.emit(this.getStatus(meetingId))
    }
  }

  private async trustedAudioPaths(meetingId: string): Promise<string[]> {
    const prefix = recordingFilePrefix(meetingId)
    let names: string[]
    try { names = await readdir(this.recordingsDirectory) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const root = await realpath(this.recordingsDirectory)
    const matches = names.filter((name) => name.startsWith(prefix) && /^part-\d+\.webm$/.test(name.slice(prefix.length)))
    const paths: string[] = []
    for (const name of matches) {
      const candidate = join(this.recordingsDirectory, name)
      const details = await lstat(candidate)
      if (details.isSymbolicLink() || !details.isFile()) throw new Error('Unsafe recording path')
      const resolved = await realpath(candidate)
      const fromRoot = relative(root, resolved)
      if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) throw new Error('Unsafe recording path')
      paths.push(resolved)
    }
    return paths.sort()
  }

  private emit(status: ProcessingStatus): void { for (const listener of this.listeners) listener(status) }
}
