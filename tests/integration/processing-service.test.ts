import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProcessingService } from '../../src/main/ai/processingService'
import { openDatabase } from '../../src/main/db/database'
import { MeetingRepository } from '../../src/main/db/meetingRepository'
import { completedPartPath } from '../../src/main/recording/recordingPaths'
import type { AudioPolicy, MeetingStatus } from '../../src/shared/contracts/meeting'

const roots: string[] = []

function harness(options: { policy?: AudioPolicy; status?: MeetingStatus; failSummary?: boolean; failCleanup?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nnote-processing-'))
  roots.push(root)
  const recordings = join(root, 'recordings')
  mkdirSync(recordings)
  const database = openDatabase(join(root, 'nnote.sqlite'))
  const meetings = new MeetingRepository(database)
  const now = '2026-07-15T00:00:00.000Z'
  meetings.create({
    id: 'meeting-1', title: 'Meeting', createdAt: now, updatedAt: now, durationMs: 1_000,
    status: options.status ?? 'recorded', audioPolicy: options.policy ?? 'delete_after_processing',
    audioPath: 'part-0.webm', audioByteCount: 6, selectedTemplateId: null,
  })
  const first = completedPartPath(recordings, 'meeting-1', 0)
  const second = completedPartPath(recordings, 'meeting-1', 1)
  writeFileSync(first, 'abc')
  writeFileSync(second, 'def')
  const transcribe = vi.fn(async () => {
    meetings.beginTranscription('meeting-1')
    return meetings.completeTranscription(
      'meeting-1',
      [{ id: 'speaker-1', meetingId: 'meeting-1', displayName: 'Speaker 1' }],
      [{ id: 'segment-1', meetingId: 'meeting-1', speakerId: 'speaker-1', startMs: 0, endMs: 1000, text: 'hello' }],
    )
  })
  const summarize = vi.fn(async () => {
    if (options.failSummary) throw Object.assign(new Error('safe summary failure'), { code: 'OPENAI_NETWORK', retryable: true })
    return meetings.completeSummary('meeting-1', [], [])
  })
  let cleanupFailures = options.failCleanup ? 1 : 0
  const service = new ProcessingService(meetings, { transcribeMeeting: transcribe }, { summarizeMeeting: summarize }, recordings, {
    remove: async (path) => {
      if (cleanupFailures-- > 0) throw Object.assign(new Error('locked'), { code: 'EBUSY' })
      rmSync(path, { force: true })
    },
  })
  return { database, meetings, service, transcribe, summarize, first, second }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('ProcessingService', () => {
  it('deletes every finalized audio part only after transcript and summary commit', async () => {
    const h = harness()
    await h.service.process('meeting-1')
    expect(h.meetings.requireById('meeting-1')).toMatchObject({ status: 'completed', audioPath: null, audioByteCount: 0 })
    expect(existsSync(h.first)).toBe(false)
    expect(existsSync(h.second)).toBe(false)
    h.database.close()
  })

  it('keeps every audio part after success when policy is keep', async () => {
    const h = harness({ policy: 'keep' })
    await h.service.process('meeting-1')
    expect(h.meetings.requireById('meeting-1')).toMatchObject({ status: 'completed', audioByteCount: 6 })
    expect(existsSync(h.first)).toBe(true)
    expect(existsSync(h.second)).toBe(true)
    h.database.close()
  })

  it('retains committed transcript and audio on summary failure then retries summary without transcription', async () => {
    const h = harness({ failSummary: true })
    await expect(h.service.process('meeting-1')).rejects.toThrow('safe summary failure')
    expect(h.meetings.requireById('meeting-1').status).toBe('failed')
    expect(h.meetings.listTranscript('meeting-1')).toHaveLength(1)
    expect(existsSync(h.first)).toBe(true)
    h.summarize.mockImplementationOnce(async () => h.meetings.completeSummary('meeting-1', [], []))
    await h.service.retry('meeting-1')
    expect(h.transcribe).toHaveBeenCalledTimes(1)
    expect(h.summarize).toHaveBeenCalledTimes(2)
    h.database.close()
  })

  it('rolls back a summary persistence failure and retries only summarization', async () => {
    const h = harness()
    h.summarize.mockImplementationOnce(async () => h.meetings.completeSummary('meeting-1', [{
      templateSectionId: 'not-a-uuid', kind: 'paragraph', text: 'invalid', items: [], orderIndex: 0,
    }] as never, []))
    await expect(h.service.process('meeting-1')).rejects.toThrow()
    expect(h.meetings.listTranscript('meeting-1')).toHaveLength(1)
    expect(h.meetings.listSummarySections('meeting-1')).toHaveLength(0)
    expect(existsSync(h.first)).toBe(true)
    await h.service.retry('meeting-1')
    expect(h.transcribe).toHaveBeenCalledTimes(1)
    expect(h.summarize).toHaveBeenCalledTimes(2)
    h.database.close()
  })

  it('retries transcription failures from transcription and requires audio', async () => {
    const h = harness()
    h.transcribe.mockImplementationOnce(async () => {
      h.meetings.beginTranscription('meeting-1')
      throw Object.assign(new Error('network'), { code: 'OPENAI_NETWORK', retryable: true })
    })
    await expect(h.service.process('meeting-1')).rejects.toThrow('network')
    expect(h.service.getStatus('meeting-1')).toMatchObject({ state: 'failed', failedStage: 'transcribing', audioRequired: true })
    await h.service.retry('meeting-1')
    expect(h.transcribe).toHaveBeenCalledTimes(2)
    h.database.close()
  })

  it('keeps the orchestration attempt authoritative when transcription records its failure', async () => {
    const h = harness()
    h.transcribe.mockImplementationOnce(async () => {
      h.meetings.beginTranscription('meeting-1')
      h.meetings.failTranscription('meeting-1', { code: 'OPENAI_NETWORK', message: 'safe', retryable: true })
      throw Object.assign(new Error('safe'), { code: 'OPENAI_NETWORK', retryable: true })
    })
    await expect(h.service.process('meeting-1')).rejects.toThrow('safe')
    expect(h.service.getStatus('meeting-1')).toMatchObject({ failedStage: 'transcribing', retryable: true })
    expect(h.meetings.latestProcessingAttempt('meeting-1')?.stage).toBe('transcribing')
    h.database.close()
  })

  it('recovers idempotently from cleanup failure without rerunning AI', async () => {
    const h = harness({ failCleanup: true })
    await h.service.process('meeting-1')
    expect(h.service.getStatus('meeting-1')).toMatchObject({ state: 'cleanup_failed', failedStage: 'cleanup', audioRequired: false })
    expect(h.meetings.requireById('meeting-1').status).toBe('completed')
    await h.service.retry('meeting-1')
    expect(h.transcribe).toHaveBeenCalledTimes(1)
    expect(h.summarize).toHaveBeenCalledTimes(1)
    expect(h.meetings.requireById('meeting-1')).toMatchObject({ audioPath: null, audioByteCount: 0 })
    h.database.close()
  })

  it('rejects concurrent starts for the same meeting and releases the lock after settle', async () => {
    const h = harness({ policy: 'keep' })
    let release!: () => void
    h.transcribe.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(h.meetings.completeTranscription('meeting-1', [], [])) }))
    const first = h.service.process('meeting-1')
    await expect(h.service.process('meeting-1')).rejects.toMatchObject({ code: 'PROCESSING_ALREADY_RUNNING' })
    release()
    await first
    expect(h.service.getStatus('meeting-1').state).toBe('completed')
    h.database.close()
  })
})
