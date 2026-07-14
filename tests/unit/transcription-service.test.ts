import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { MeetingRepository } from '../../src/main/db/meetingRepository'
import type { CredentialStore } from '../../src/main/credentials/credentialStore'
import { OpenAiGateway, type OpenAiTranscriptionClient } from '../../src/main/ai/openAiGateway'
import { TranscriptionService } from '../../src/main/ai/transcriptionService'
import { completedPartPath } from '../../src/main/recording/recordingPaths'
import type { Meeting } from '../../src/shared/contracts/meeting'

const directories: string[] = []

function harness(status: Meeting['status'] = 'recorded') {
  const root = mkdtempSync(join(tmpdir(), 'nnote-transcription-'))
  directories.push(root)
  const recordingsDirectory = join(root, 'recordings')
  mkdirSync(recordingsDirectory)
  const database = openDatabase(join(root, 'nnote.sqlite'))
  const meetings = new MeetingRepository(database)
  meetings.create({
    id: 'meeting-1',
    title: 'Planning',
    createdAt: '2026-07-14T12:00:00.000Z',
    updatedAt: '2026-07-14T12:00:00.000Z',
    durationMs: 12_000,
    status,
    audioPolicy: 'delete_after_processing',
    audioPath: 'first-part.webm',
    audioByteCount: 6,
    selectedTemplateId: null,
  })
  return { root, recordingsDirectory, database, meetings }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('OpenAiGateway', () => {
  it('uses the exact SDK request shape and retrieves the credential for every call', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nnote-gateway-'))
    directories.push(root)
    const firstPath = join(root, 'meeting.webm')
    const secondPath = join(root, 'meeting-2.webm')
    writeFileSync(firstPath, Buffer.from([1]))
    writeFileSync(secondPath, Buffer.from([2]))
    const credentials: CredentialStore = {
      get: vi.fn().mockResolvedValue('sk-test-secret'),
      set: vi.fn(),
      delete: vi.fn(),
    }
    const create = vi.fn(async (input: unknown) => {
      const file = (input as { file: AsyncIterable<unknown> }).file
      for await (const _chunk of file) { /* consume the SDK upload stream */ }
      return { duration: 1, segments: [] }
    })
    const factory = vi.fn((): OpenAiTranscriptionClient => ({
      audio: { transcriptions: { create } },
    }))
    const gateway = new OpenAiGateway(credentials, factory)

    await gateway.transcribe({
      filePath: firstPath,
      model: 'gpt-4o-transcribe-diarize',
      responseFormat: 'diarized_json',
      chunkingStrategy: 'auto',
    })
    await gateway.transcribe({
      filePath: secondPath,
      model: 'gpt-4o-transcribe-diarize',
      responseFormat: 'diarized_json',
      chunkingStrategy: 'auto',
    })

    expect(credentials.get).toHaveBeenCalledTimes(2)
    expect(factory).toHaveBeenNthCalledWith(1, 'sk-test-secret')
    expect(create).toHaveBeenNthCalledWith(1, {
      file: expect.objectContaining({ path: firstPath }),
      model: 'gpt-4o-transcribe-diarize',
      response_format: 'diarized_json',
      chunking_strategy: 'auto',
    })
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('responseFormat')
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('chunkingStrategy')
  })
})

describe('TranscriptionService', () => {
  it('transcribes finalized parts in order and normalizes stable part-scoped speakers', async () => {
    const h = harness()
    const second = completedPartPath(h.recordingsDirectory, 'meeting-1', 1)
    const first = completedPartPath(h.recordingsDirectory, 'meeting-1', 0)
    writeFileSync(second, Buffer.from([2, 2, 2]))
    writeFileSync(first, Buffer.from([1, 1, 1]))
    const requests: Array<{ filePath: string; model: string; responseFormat: string; chunkingStrategy: string }> = []
    const gateway = {
      async transcribe(request: (typeof requests)[number]) {
        requests.push(request)
        return requests.length === 1
          ? { durationSeconds: 5, segments: [{ speaker: 'A', startSeconds: 0, endSeconds: 2, text: 'Hello' }] }
          : { durationSeconds: 7, segments: [{ speaker: 'A', startSeconds: 1, endSeconds: 3, text: 'Again' }] }
      },
    }

    const result = await new TranscriptionService(h.meetings, gateway, h.recordingsDirectory).transcribeMeeting('meeting-1')

    expect(requests.map(({ filePath }) => filePath)).toEqual([first, second])
    expect(requests[0]).toMatchObject({
      model: 'gpt-4o-transcribe-diarize',
      responseFormat: 'diarized_json',
      chunkingStrategy: 'auto',
    })
    expect(result.speakers).toEqual([
      { id: '0:A', meetingId: 'meeting-1', displayName: 'Speaker A' },
      { id: '1:A', meetingId: 'meeting-1', displayName: 'Speaker A' },
    ])
    expect(result.segments).toEqual([
      { id: '0:0', meetingId: 'meeting-1', speakerId: '0:A', startMs: 0, endMs: 2_000, text: 'Hello' },
      { id: '1:0', meetingId: 'meeting-1', speakerId: '1:A', startMs: 6_000, endMs: 8_000, text: 'Again' },
    ])
    expect(h.meetings.requireById('meeting-1').status).toBe('summarizing')
    expect(h.meetings.listTranscript('meeting-1')).toEqual(result.segments)
    expect(h.meetings.listSpeakers('meeting-1')).toEqual(result.speakers)
    h.database.close()
  })

  it('rejects a malformed non-monotonic response before replacing the prior transcript', async () => {
    const h = harness('completed')
    const part = completedPartPath(h.recordingsDirectory, 'meeting-1', 0)
    writeFileSync(part, Buffer.from([1]))
    h.database.prepare('INSERT INTO speakers (id, meeting_id, display_name) VALUES (?, ?, ?)').run('old', 'meeting-1', 'Old')
    h.meetings.replaceTranscript('meeting-1', [{ id: 'old:0', meetingId: 'meeting-1', speakerId: 'old', startMs: 0, endMs: 10, text: 'Keep me' }])
    const gateway = {
      async transcribe() {
        return { durationSeconds: 3, segments: [
          { speaker: 'A', startSeconds: 2, endSeconds: 3, text: 'Later' },
          { speaker: 'A', startSeconds: 1, endSeconds: 2, text: 'Earlier' },
        ] }
      },
    }

    await expect(new TranscriptionService(h.meetings, gateway, h.recordingsDirectory).transcribeMeeting('meeting-1')).rejects.toMatchObject({ code: 'OPENAI_MALFORMED_RESPONSE' })

    expect(h.meetings.listTranscript('meeting-1')).toEqual([{ id: 'old:0', meetingId: 'meeting-1', speakerId: 'old', startMs: 0, endMs: 10, text: 'Keep me' }])
    expect(h.meetings.requireById('meeting-1').status).toBe('failed')
    h.database.close()
  })

  it('preserves audio metadata, summary, and prior transcript while recording only a redacted typed failure', async () => {
    const h = harness('completed')
    const part = completedPartPath(h.recordingsDirectory, 'meeting-1', 0)
    writeFileSync(part, Buffer.from([1]))
    h.database.prepare('INSERT INTO summary_sections (id, meeting_id, kind, content_json, order_index) VALUES (?, ?, ?, ?, ?)').run('summary-1', 'meeting-1', 'paragraph', JSON.stringify({ text: 'Existing summary' }), 0)
    h.database.prepare('INSERT INTO speakers (id, meeting_id, display_name) VALUES (?, ?, ?)').run('old', 'meeting-1', 'Old')
    h.meetings.replaceTranscript('meeting-1', [{ id: 'old:0', meetingId: 'meeting-1', speakerId: 'old', startMs: 0, endMs: 10, text: 'Existing transcript' }])
    const gateway = { async transcribe() { throw Object.assign(new Error(`Authorization: Bearer sk-live-secret failed at ${part}`), { status: 429 }) } }

    await expect(new TranscriptionService(h.meetings, gateway, h.recordingsDirectory).transcribeMeeting('meeting-1')).rejects.toMatchObject({ code: 'OPENAI_RATE_LIMITED' })

    expect(h.meetings.requireById('meeting-1')).toMatchObject({ status: 'failed', audioPath: 'first-part.webm', audioByteCount: 6 })
    expect(h.meetings.listTranscript('meeting-1')[0]?.text).toBe('Existing transcript')
    expect(h.database.prepare('SELECT content_json FROM summary_sections WHERE meeting_id = ?').get('meeting-1')).toEqual({ content_json: JSON.stringify({ text: 'Existing summary' }) })
    const attempt = h.database.prepare('SELECT stage, sanitized_error FROM processing_attempts WHERE meeting_id = ? ORDER BY rowid DESC LIMIT 1').get('meeting-1') as { stage: string; sanitized_error: string }
    expect(attempt.stage).toBe('transcription')
    expect(JSON.parse(attempt.sanitized_error)).toMatchObject({ code: 'OPENAI_RATE_LIMITED' })
    expect(attempt.sanitized_error).not.toContain('sk-live-secret')
    expect(attempt.sanitized_error).not.toContain(part)
    h.database.close()
  })

  it('records distinct failed attempts when a retry fails in the same millisecond', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-14T12:00:00.000Z'))
    const h = harness()
    writeFileSync(completedPartPath(h.recordingsDirectory, 'meeting-1', 0), Buffer.from([1]))
    const service = new TranscriptionService(h.meetings, { async transcribe() { throw Object.assign(new Error('busy'), { status: 429 }) } }, h.recordingsDirectory)

    await expect(service.transcribeMeeting('meeting-1')).rejects.toMatchObject({ code: 'OPENAI_RATE_LIMITED' })
    await expect(service.transcribeMeeting('meeting-1')).rejects.toMatchObject({ code: 'OPENAI_RATE_LIMITED' })

    expect((h.database.prepare('SELECT count(*) AS count FROM processing_attempts WHERE meeting_id = ?').get('meeting-1') as { count: number }).count).toBe(2)
    h.database.close()
  })

  it('redacts the recordings directory when part discovery itself fails', async () => {
    const h = harness()
    rmSync(h.recordingsDirectory, { recursive: true })

    await expect(new TranscriptionService(h.meetings, { async transcribe() { throw new Error('unreachable') } }, h.recordingsDirectory).transcribeMeeting('meeting-1')).rejects.toMatchObject({ code: 'OPENAI_UNKNOWN' })

    const { sanitized_error: sanitizedError } = h.database.prepare('SELECT sanitized_error FROM processing_attempts WHERE meeting_id = ?').get('meeting-1') as { sanitized_error: string }
    expect(sanitizedError).not.toContain(h.recordingsDirectory)
    expect(sanitizedError).toContain('[REDACTED]')
    h.database.close()
  })
})
