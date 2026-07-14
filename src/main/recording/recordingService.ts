import { open, readdir, rename, rm, stat, type FileHandle } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { MeetingRepository } from '../db/meetingRepository'
import {
  completedPartPath,
  manifestPath,
  pendingPartPath,
  recordingFilePrefix,
  temporaryManifestPath,
} from './recordingPaths'
import {
  createSessionManifest,
  readSessionManifest,
  writeSessionManifest,
  type RecordingPartManifest,
  type SessionManifest,
} from './sessionManifest'
import {
  evaluateRecordingSize,
  type AppendChunkInput,
  type RecordingProgress,
} from './recordingTypes'

interface ActiveHandle {
  partIndex: number
  handle: FileHandle
}

export class RecordingService {
  private readonly sessions = new Map<string, SessionManifest>()
  private readonly handles = new Map<string, ActiveHandle>()

  constructor(
    private readonly meetings: MeetingRepository,
    private readonly recordingsDirectory: string,
  ) {}

  async start(meetingId: string): Promise<RecordingProgress> {
    const meeting = this.meetings.requireById(meetingId)
    if (meeting.status !== 'recording' && meeting.status !== 'recoverable') {
      throw new Error(`Meeting ${meetingId} is not available for recording`)
    }

    let manifest = await readSessionManifest(this.recordingsDirectory, meetingId)
    if (manifest === null) {
      manifest = createSessionManifest(meetingId)
      await writeSessionManifest(this.recordingsDirectory, manifest)
    }
    this.sessions.set(meetingId, manifest)
    this.meetings.updateRecordingProgress(meetingId, manifest.totalBytes, manifest.durationMs)
    return this.progress(manifest, null)
  }

  async appendChunk(input: AppendChunkInput): Promise<RecordingProgress> {
    const manifest = this.requireSession(input.meetingId)
    if (input.partIndex !== manifest.activePartIndex) {
      throw new Error(`Expected part index ${manifest.activePartIndex}, received ${input.partIndex}`)
    }
    if (input.durationMs < manifest.durationMs) {
      throw new Error('Recording duration must not decrease')
    }

    const currentPart = manifest.parts.find(({ partIndex }) => partIndex === input.partIndex)
    const expectedChunkIndex = (currentPart?.lastChunkIndex ?? -1) + 1
    if (input.chunkIndex < expectedChunkIndex) {
      return this.progress(manifest, null)
    }
    if (input.chunkIndex > expectedChunkIndex) {
      throw new Error(`Expected chunk index ${expectedChunkIndex}, received ${input.chunkIndex}`)
    }

    const part = currentPart ?? this.emptyPart(input.partIndex)
    const active = await this.openActivePart(input.meetingId, part)
    await this.appendAll(active.handle, input.bytes)
    await active.handle.sync()

    const totalBytes = manifest.totalBytes + input.bytes.byteLength
    const partBytes = part.byteCount + input.bytes.byteLength
    const policy = evaluateRecordingSize(partBytes)
    const nextPart: RecordingPartManifest = {
      ...part,
      lastChunkIndex: input.chunkIndex,
      byteCount: partBytes,
      durationMs: input.durationMs,
      completed: policy.rollPart,
    }
    const parts = manifest.parts.filter(({ partIndex }) => partIndex !== input.partIndex)
    parts.push(nextPart)
    parts.sort((left, right) => left.partIndex - right.partIndex)
    const nextManifest: SessionManifest = {
      ...manifest,
      activePartIndex: policy.rollPart ? input.partIndex + 1 : input.partIndex,
      totalBytes,
      durationMs: input.durationMs,
      parts,
    }

    await writeSessionManifest(this.recordingsDirectory, nextManifest)
    this.sessions.set(input.meetingId, nextManifest)
    this.meetings.updateRecordingProgress(input.meetingId, totalBytes, input.durationMs)

    if (policy.rollPart) {
      await this.closeHandle(input.meetingId)
      await rename(
        pendingPartPath(this.recordingsDirectory, input.meetingId, input.partIndex),
        completedPartPath(this.recordingsDirectory, input.meetingId, input.partIndex),
      )
    }

    return this.progress(nextManifest, policy.rollPart ? input.partIndex + 1 : null)
  }

  async pause(meetingId: string): Promise<void> {
    this.requireSession(meetingId)
    await this.closeHandle(meetingId)
  }

  async resume(meetingId: string): Promise<RecordingProgress> {
    return this.progress(this.requireSession(meetingId), null)
  }

  async stop(meetingId: string): Promise<void> {
    const manifest = this.requireSession(meetingId)
    await this.closeHandle(meetingId)

    const completedManifest: SessionManifest = {
      ...manifest,
      parts: manifest.parts.map((part) => ({ ...part, completed: true })),
    }
    await writeSessionManifest(this.recordingsDirectory, completedManifest)

    for (const part of manifest.parts) {
      if (!part.completed) {
        await rename(
          pendingPartPath(this.recordingsDirectory, meetingId, part.partIndex),
          completedPartPath(this.recordingsDirectory, meetingId, part.partIndex),
        )
      }
    }

    const firstAudioPath =
      manifest.parts.length === 0
        ? null
        : relative(
            this.recordingsDirectory,
            completedPartPath(this.recordingsDirectory, meetingId, manifest.parts[0].partIndex),
          )
    this.meetings.completeRecording(
      meetingId,
      manifest.totalBytes,
      manifest.durationMs,
      firstAudioPath,
    )
    await rm(manifestPath(this.recordingsDirectory, meetingId), { force: true })
    this.sessions.delete(meetingId)
  }

  async discard(meetingId: string): Promise<void> {
    this.requireSession(meetingId)
    await this.closeHandle(meetingId)
    const prefix = recordingFilePrefix(meetingId)
    let entries: string[] = []
    try {
      entries = await readdir(this.recordingsDirectory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith(prefix))
        .map((entry) => rm(join(this.recordingsDirectory, entry), { force: true })),
    )
    await rm(manifestPath(this.recordingsDirectory, meetingId), { force: true })
    await rm(temporaryManifestPath(this.recordingsDirectory, meetingId), { force: true })
    this.meetings.discardRecording(meetingId)
    this.sessions.delete(meetingId)
  }

  async close(): Promise<void> {
    await Promise.all([...this.handles.keys()].map((meetingId) => this.closeHandle(meetingId)))
    this.sessions.clear()
  }

  private requireSession(meetingId: string): SessionManifest {
    const manifest = this.sessions.get(meetingId)
    if (manifest === undefined) {
      throw new Error(`Recording session ${meetingId} has not been started`)
    }
    return manifest
  }

  private emptyPart(partIndex: number): RecordingPartManifest {
    return { partIndex, lastChunkIndex: -1, byteCount: 0, durationMs: 0, completed: false }
  }

  private progress(manifest: SessionManifest, rolledToPartIndex: number | null): RecordingProgress {
    return {
      totalBytes: manifest.totalBytes,
      durationMs: manifest.durationMs,
      warn: evaluateRecordingSize(manifest.totalBytes).warn,
      rolledToPartIndex,
    }
  }

  private async openActivePart(meetingId: string, part: RecordingPartManifest): Promise<ActiveHandle> {
    const existing = this.handles.get(meetingId)
    if (existing !== undefined) {
      if (existing.partIndex !== part.partIndex) {
        await this.closeHandle(meetingId)
      } else {
        return existing
      }
    }

    const path = pendingPartPath(this.recordingsDirectory, meetingId, part.partIndex)
    const handle = await open(path, 'a+')
    try {
      const file = await stat(path)
      if (file.size < part.byteCount) {
        throw new Error(`Recording part ${part.partIndex} is shorter than its manifest`)
      }
      if (file.size > part.byteCount) {
        await handle.truncate(part.byteCount)
        await handle.sync()
      }
    } catch (error) {
      await handle.close()
      throw error
    }
    const active = { partIndex: part.partIndex, handle }
    this.handles.set(meetingId, active)
    return active
  }

  private async appendAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
    let offset = 0
    while (offset < bytes.byteLength) {
      const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset)
      if (bytesWritten === 0) {
        throw new Error('Recording chunk write made no progress')
      }
      offset += bytesWritten
    }
  }

  private async closeHandle(meetingId: string): Promise<void> {
    const active = this.handles.get(meetingId)
    if (active === undefined) {
      return
    }
    this.handles.delete(meetingId)
    await active.handle.close()
  }
}
