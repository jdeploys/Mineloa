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
    } else {
      await this.reconcilePartFiles(manifest)
    }
    this.sessions.set(meetingId, manifest)
    this.meetings.updateRecordingProgress(meetingId, manifest.totalBytes, manifest.durationMs)
    return this.progress(manifest, null)
  }

  async appendChunk(input: AppendChunkInput): Promise<RecordingProgress> {
    const manifest = this.requireSession(input.meetingId)
    if (input.partIndex !== manifest.activePartIndex) {
      const completedPart = manifest.parts.find(({ partIndex }) => partIndex === input.partIndex)
      if (
        completedPart?.completed === true &&
        input.partIndex === manifest.activePartIndex - 1 &&
        input.chunkIndex === completedPart.lastChunkIndex
      ) {
        return this.progress(manifest, manifest.activePartIndex)
      }
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

    if (policy.rollPart) {
      await this.closeHandle(input.meetingId)
      await this.finalizePart(input.meetingId, input.partIndex, partBytes)
    }

    await writeSessionManifest(this.recordingsDirectory, nextManifest)
    this.sessions.set(input.meetingId, nextManifest)
    this.meetings.updateRecordingProgress(input.meetingId, totalBytes, input.durationMs)

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

    for (const part of manifest.parts) {
      if (!part.completed) {
        await this.finalizePart(meetingId, part.partIndex, part.byteCount)
      }
    }

    const completedManifest: SessionManifest = {
      ...manifest,
      finalized: true,
      parts: manifest.parts.map((part) => ({ ...part, completed: true })),
    }
    await writeSessionManifest(this.recordingsDirectory, completedManifest)
    this.sessions.set(meetingId, completedManifest)

    const firstAudioPath =
      manifest.parts.length === 0
        ? null
        : relative(
            this.recordingsDirectory,
            completedPartPath(this.recordingsDirectory, meetingId, manifest.parts[0].partIndex),
          )
    const meeting = this.meetings.requireById(meetingId)
    if (meeting.status === 'recorded') {
      if (
        meeting.audioByteCount !== manifest.totalBytes ||
        meeting.durationMs !== manifest.durationMs ||
        meeting.audioPath !== firstAudioPath
      ) {
        throw new Error('Recorded meeting metadata does not match the recording session')
      }
    } else {
      this.meetings.completeRecording(
        meetingId,
        manifest.totalBytes,
        manifest.durationMs,
        firstAudioPath,
      )
    }
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
    const activePart = manifest.parts.find(
      ({ partIndex }) => partIndex === manifest.activePartIndex,
    )
    const activePartBytes = activePart?.byteCount ?? 0
    return {
      totalBytes: manifest.totalBytes,
      durationMs: manifest.durationMs,
      warn: evaluateRecordingSize(activePartBytes).warn,
      rolledToPartIndex,
      activePartIndex: manifest.activePartIndex,
      nextChunkIndex: (activePart?.lastChunkIndex ?? -1) + 1,
    }
  }

  private async reconcilePartFiles(manifest: SessionManifest): Promise<void> {
    for (const part of manifest.parts) {
      const pending = pendingPartPath(this.recordingsDirectory, manifest.meetingId, part.partIndex)
      const completed = completedPartPath(this.recordingsDirectory, manifest.meetingId, part.partIndex)
      const [pendingSize, completedSize] = await Promise.all([
        this.fileSize(pending),
        this.fileSize(completed),
      ])

      if (pendingSize !== null && completedSize !== null) {
        throw new Error(`Recording part ${part.partIndex} has both pending and completed files`)
      }

      if (part.completed) {
        if (completedSize !== null) {
          this.assertCommittedPartSize(part, completedSize)
          continue
        }
        if (pendingSize === null) {
          throw new Error(`Completed recording part ${part.partIndex} is missing`)
        }
        this.assertCommittedPartSize(part, pendingSize)
        await rename(pending, completed)
        continue
      }

      if (pendingSize !== null) {
        if (pendingSize < part.byteCount) {
          throw new Error(`Recording part ${part.partIndex} is shorter than its manifest`)
        }
        if (pendingSize > part.byteCount) {
          await this.truncateAndSync(pending, part.byteCount)
        }
        continue
      }
      if (completedSize === null) {
        throw new Error(`Pending recording part ${part.partIndex} is missing`)
      }
      if (completedSize < part.byteCount) {
        throw new Error(`Recording part ${part.partIndex} is shorter than its manifest`)
      }
      await rename(completed, pending)
      if (completedSize > part.byteCount) {
        await this.truncateAndSync(pending, part.byteCount)
      }
    }
  }

  private async finalizePart(
    meetingId: string,
    partIndex: number,
    expectedBytes: number,
  ): Promise<void> {
    const pending = pendingPartPath(this.recordingsDirectory, meetingId, partIndex)
    const completed = completedPartPath(this.recordingsDirectory, meetingId, partIndex)
    const [pendingSize, completedSize] = await Promise.all([
      this.fileSize(pending),
      this.fileSize(completed),
    ])
    if (pendingSize !== null && completedSize !== null) {
      throw new Error(`Recording part ${partIndex} has both pending and completed files`)
    }
    if (completedSize !== null) {
      if (completedSize !== expectedBytes) {
        throw new Error(`Completed recording part ${partIndex} has an unexpected size`)
      }
      return
    }
    if (pendingSize === null) {
      throw new Error(`Recording part ${partIndex} is missing`)
    }
    if (pendingSize !== expectedBytes) {
      throw new Error(`Pending recording part ${partIndex} has an unexpected size`)
    }
    await rename(pending, completed)
  }

  private async fileSize(path: string): Promise<number | null> {
    try {
      return (await stat(path)).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw error
    }
  }

  private async truncateAndSync(path: string, byteCount: number): Promise<void> {
    const handle = await open(path, 'r+')
    try {
      await handle.truncate(byteCount)
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  private assertCommittedPartSize(part: RecordingPartManifest, size: number): void {
    if (size !== part.byteCount) {
      throw new Error(`Completed recording part ${part.partIndex} does not match its manifest`)
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
