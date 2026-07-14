import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { MeetingRepository } from '../../src/main/db/meetingRepository'
import {
  completedPartPath,
  manifestPath,
  pendingPartPath,
} from '../../src/main/recording/recordingPaths'
import { RecordingService } from '../../src/main/recording/recordingService'
import { RECORDING_PART_LIMIT_BYTES } from '../../src/main/recording/recordingTypes'
import type { Meeting } from '../../src/shared/contracts/meeting'

const directories: string[] = []

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), 'nnote-recording-'))
  directories.push(root)
  const databasePath = join(root, 'nnote.sqlite')
  const recordingsDirectory = join(root, 'recordings')
  const database = openDatabase(databasePath)
  const repository = new MeetingRepository(database)
  const meeting: Meeting = {
    id: 'meeting-1',
    title: 'Crash-safe recording',
    createdAt: '2026-07-14T12:00:00.000Z',
    updatedAt: '2026-07-14T12:00:00.000Z',
    durationMs: 0,
    status: 'recording',
    audioPolicy: 'keep',
    audioPath: null,
    audioByteCount: 0,
    selectedTemplateId: null,
  }
  repository.create(meeting)
  return {
    root,
    databasePath,
    recordingsDirectory,
    database,
    repository,
    service: new RecordingService(repository, recordingsDirectory),
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('RecordingService', () => {
  it('appends ordered chunks and preserves them across service reopen', async () => {
    const harness = createHarness()
    await harness.service.start('meeting-1')
    await harness.service.appendChunk({
      meetingId: 'meeting-1',
      partIndex: 0,
      chunkIndex: 0,
      durationMs: 1_000,
      bytes: Uint8Array.from([1, 2]),
    })
    await harness.service.close()

    const reopened = new RecordingService(harness.repository, harness.recordingsDirectory)
    await reopened.start('meeting-1')
    const progress = await reopened.appendChunk({
      meetingId: 'meeting-1',
      partIndex: 0,
      chunkIndex: 1,
      durationMs: 2_000,
      bytes: Uint8Array.from([3, 4]),
    })

    expect(readFileSync(pendingPartPath(harness.recordingsDirectory, 'meeting-1', 0))).toEqual(
      Buffer.from([1, 2, 3, 4]),
    )
    expect(progress).toMatchObject({ totalBytes: 4, durationMs: 2_000 })
    expect(harness.repository.requireById('meeting-1').audioByteCount).toBe(4)
    await reopened.close()
    harness.database.close()
  })

  it('treats a duplicate chunk index as idempotent', async () => {
    const harness = createHarness()
    await harness.service.start('meeting-1')
    const chunk = {
      meetingId: 'meeting-1',
      partIndex: 0,
      chunkIndex: 0,
      durationMs: 1_000,
      bytes: Uint8Array.from([1, 2, 3]),
    }

    const first = await harness.service.appendChunk(chunk)
    const duplicate = await harness.service.appendChunk(chunk)

    expect(duplicate).toEqual(first)
    expect(readFileSync(pendingPartPath(harness.recordingsDirectory, 'meeting-1', 0))).toEqual(
      Buffer.from([1, 2, 3]),
    )
    await harness.service.close()
    harness.database.close()
  })

  it('rejects a skipped chunk index without appending bytes', async () => {
    const harness = createHarness()
    await harness.service.start('meeting-1')

    await expect(
      harness.service.appendChunk({
        meetingId: 'meeting-1',
        partIndex: 0,
        chunkIndex: 1,
        durationMs: 1_000,
        bytes: Uint8Array.from([9]),
      }),
    ).rejects.toThrow(/expected chunk index 0/i)
    await expect(stat(pendingPartPath(harness.recordingsDirectory, 'meeting-1', 0))).rejects.toMatchObject(
      { code: 'ENOENT' },
    )
    await harness.service.close()
    harness.database.close()
  })

  it('stop renames the pending WebM and marks the meeting recorded', async () => {
    const harness = createHarness()
    await harness.service.start('meeting-1')
    await harness.service.appendChunk({
      meetingId: 'meeting-1',
      partIndex: 0,
      chunkIndex: 0,
      durationMs: 1_000,
      bytes: Uint8Array.from([7, 8]),
    })

    await harness.service.stop('meeting-1')

    await expect(stat(pendingPartPath(harness.recordingsDirectory, 'meeting-1', 0))).rejects.toMatchObject(
      { code: 'ENOENT' },
    )
    expect(readFileSync(completedPartPath(harness.recordingsDirectory, 'meeting-1', 0))).toEqual(
      Buffer.from([7, 8]),
    )
    expect(harness.repository.requireById('meeting-1')).toMatchObject({
      status: 'recorded',
      audioByteCount: 2,
      durationMs: 1_000,
    })
    await expect(stat(manifestPath(harness.recordingsDirectory, 'meeting-1'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await harness.service.close()
    harness.database.close()
  })

  it('explicit discard deletes recording files', async () => {
    const harness = createHarness()
    await harness.service.start('meeting-1')
    await harness.service.appendChunk({
      meetingId: 'meeting-1',
      partIndex: 0,
      chunkIndex: 0,
      durationMs: 1_000,
      bytes: Uint8Array.from([5]),
    })

    await harness.service.discard('meeting-1')

    await expect(stat(pendingPartPath(harness.recordingsDirectory, 'meeting-1', 0))).rejects.toMatchObject(
      { code: 'ENOENT' },
    )
    await expect(stat(manifestPath(harness.recordingsDirectory, 'meeting-1'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(harness.repository.requireById('meeting-1').status).toBe('deleted')
    await harness.service.close()
    harness.database.close()
  })

  it('pause, navigation, and service close keep recording files', async () => {
    const harness = createHarness()
    await harness.service.start('meeting-1')
    await harness.service.appendChunk({
      meetingId: 'meeting-1',
      partIndex: 0,
      chunkIndex: 0,
      durationMs: 1_000,
      bytes: Uint8Array.from([4, 2]),
    })

    await harness.service.pause('meeting-1')
    // Navigation has no persistence action: opening another view must not call discard.
    await harness.service.resume('meeting-1')
    await harness.service.close()

    expect(readFileSync(pendingPartPath(harness.recordingsDirectory, 'meeting-1', 0))).toEqual(
      Buffer.from([4, 2]),
    )
    expect(readFileSync(manifestPath(harness.recordingsDirectory, 'meeting-1'), 'utf8')).toContain(
      '"lastChunkIndex": 0',
    )
    expect(harness.repository.requireById('meeting-1').status).toBe('recording')
    harness.database.close()
  })

  it('rolls one full part without immediately rolling the next part', async () => {
    const harness = createHarness()
    await harness.service.start('meeting-1')

    const rolled = await harness.service.appendChunk({
      meetingId: 'meeting-1',
      partIndex: 0,
      chunkIndex: 0,
      durationMs: 1_000,
      bytes: new Uint8Array(RECORDING_PART_LIMIT_BYTES),
    })
    const nextPart = await harness.service.appendChunk({
      meetingId: 'meeting-1',
      partIndex: 1,
      chunkIndex: 0,
      durationMs: 2_000,
      bytes: Uint8Array.from([6]),
    })

    expect(rolled.rolledToPartIndex).toBe(1)
    expect(nextPart).toMatchObject({
      totalBytes: RECORDING_PART_LIMIT_BYTES + 1,
      rolledToPartIndex: null,
    })
    expect(readFileSync(completedPartPath(harness.recordingsDirectory, 'meeting-1', 0))).toHaveLength(
      RECORDING_PART_LIMIT_BYTES,
    )
    expect(readFileSync(pendingPartPath(harness.recordingsDirectory, 'meeting-1', 1))).toEqual(
      Buffer.from([6]),
    )
    await harness.service.close()
    harness.database.close()
  })
})
