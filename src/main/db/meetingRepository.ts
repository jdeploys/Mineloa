import type Database from 'better-sqlite3'
import {
  MeetingSchema,
  TranscriptSegmentSchema,
  type Meeting,
  type TranscriptSegment,
} from '../../shared/contracts/meeting'
import { assertMeetingTransition } from '../domain/meetingState'

interface MeetingRow {
  id: string
  title: string
  created_at: string
  updated_at: string
  duration_ms: number
  status: string
  audio_policy: string
  audio_path: string | null
  audio_byte_count: number
  selected_template_id: string | null
}

interface TranscriptSegmentRow {
  id: string
  meeting_id: string
  speaker_id: string | null
  start_ms: number
  end_ms: number
  text: string
}

function toMeeting(row: MeetingRow): Meeting {
  return MeetingSchema.parse({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    durationMs: row.duration_ms,
    status: row.status,
    audioPolicy: row.audio_policy,
    audioPath: row.audio_path,
    audioByteCount: row.audio_byte_count,
    selectedTemplateId: row.selected_template_id,
  })
}

function toTranscriptSegment(row: TranscriptSegmentRow): TranscriptSegment {
  return TranscriptSegmentSchema.parse({
    id: row.id,
    meetingId: row.meeting_id,
    speakerId: row.speaker_id,
    startMs: row.start_ms,
    endMs: row.end_ms,
    text: row.text,
  })
}

function inTransaction<T>(database: Database.Database, write: () => T): T {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = write()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export class MeetingRepository {
  constructor(private readonly database: Database.Database) {}

  create(value: Meeting): Meeting {
    const meeting = MeetingSchema.parse(value)
    return inTransaction(this.database, () => {
      this.database
        .prepare(
          `INSERT INTO meetings (
            id, title, created_at, updated_at, duration_ms, status,
            audio_policy, audio_path, audio_byte_count, selected_template_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          meeting.id,
          meeting.title,
          meeting.createdAt,
          meeting.updatedAt,
          meeting.durationMs,
          meeting.status,
          meeting.audioPolicy,
          meeting.audioPath,
          meeting.audioByteCount,
          meeting.selectedTemplateId,
        )
      return this.requireById(meeting.id)
    })
  }

  findById(id: string): Meeting | null {
    const row = this.database.prepare('SELECT * FROM meetings WHERE id = ?').get(id) as
      | MeetingRow
      | undefined
    return row === undefined ? null : toMeeting(row)
  }

  requireById(id: string): Meeting {
    const meeting = this.findById(id)
    if (meeting === null) {
      throw new Error(`Meeting ${id} was not found`)
    }
    return meeting
  }

  updateRecordingProgress(id: string, audioByteCount: number, durationMs: number): Meeting {
    if (!Number.isSafeInteger(audioByteCount) || audioByteCount < 0) {
      throw new Error('Recording byte count must be a non-negative safe integer')
    }
    if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
      throw new Error('Recording duration must be a non-negative safe integer')
    }
    return inTransaction(this.database, () => {
      const meeting = this.requireById(id)
      if (meeting.status !== 'recording' && meeting.status !== 'recoverable') {
        throw new Error(`Meeting ${id} is not available for recording progress`)
      }
      this.database
        .prepare(
          `UPDATE meetings
           SET audio_byte_count = ?, duration_ms = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(audioByteCount, durationMs, new Date().toISOString(), id)
      return this.requireById(id)
    })
  }

  completeRecording(
    id: string,
    audioByteCount: number,
    durationMs: number,
    audioPath: string | null,
  ): Meeting {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(id)
      assertMeetingTransition(meeting.status, 'recorded')
      this.database
        .prepare(
          `UPDATE meetings
           SET status = 'recorded', audio_byte_count = ?, duration_ms = ?,
               audio_path = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(audioByteCount, durationMs, audioPath, new Date().toISOString(), id)
      return this.requireById(id)
    })
  }

  discardRecording(id: string): Meeting {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(id)
      assertMeetingTransition(meeting.status, 'deleted', { explicitDelete: true })
      this.database
        .prepare(
          `UPDATE meetings
           SET status = 'deleted', audio_path = NULL, audio_byte_count = 0, updated_at = ?
           WHERE id = ?`,
        )
        .run(new Date().toISOString(), id)
      return this.requireById(id)
    })
  }

  replaceTranscript(meetingId: string, values: readonly TranscriptSegment[]): TranscriptSegment[] {
    return inTransaction(this.database, () => {
      this.requireById(meetingId)
      this.database.prepare('DELETE FROM transcript_segments WHERE meeting_id = ?').run(meetingId)
      const insert = this.database.prepare(
        `INSERT INTO transcript_segments
          (id, meeting_id, speaker_id, start_ms, end_ms, text)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )

      for (const value of values) {
        const segment = TranscriptSegmentSchema.parse(value)
        if (segment.meetingId !== meetingId) {
          throw new Error('Transcript segment belongs to a different meeting')
        }
        insert.run(
          segment.id,
          segment.meetingId,
          segment.speakerId,
          segment.startMs,
          segment.endMs,
          segment.text,
        )
      }
      return this.listTranscript(meetingId)
    })
  }

  listTranscript(meetingId: string): TranscriptSegment[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM transcript_segments
         WHERE meeting_id = ? ORDER BY start_ms, end_ms, id`,
      )
      .all(meetingId) as TranscriptSegmentRow[]
    return rows.map(toTranscriptSegment)
  }
}
