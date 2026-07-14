import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import {
  MeetingSchema,
  SpeakerSchema,
  TranscriptSegmentSchema,
  type Meeting,
  type Speaker,
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

interface SpeakerRow {
  id: string
  meeting_id: string
  display_name: string
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

  listByStatuses(statuses: readonly Meeting['status'][]): Meeting[] {
    if (statuses.length === 0) return []
    const placeholders = statuses.map(() => '?').join(', ')
    const rows = this.database
      .prepare(`SELECT * FROM meetings WHERE status IN (${placeholders}) ORDER BY created_at, id`)
      .all(...statuses) as MeetingRow[]
    return rows.map(toMeeting)
  }

  transitionRecordingStatus(id: string, status: 'recording' | 'recoverable'): Meeting {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(id)
      if (meeting.status === status) return meeting
      assertMeetingTransition(meeting.status, status)
      this.database
        .prepare('UPDATE meetings SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, new Date().toISOString(), id)
      return this.requireById(id)
    })
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

  listSpeakers(meetingId: string): Speaker[] {
    const rows = this.database
      .prepare('SELECT * FROM speakers WHERE meeting_id = ? ORDER BY id')
      .all(meetingId) as SpeakerRow[]
    return rows.map((row) =>
      SpeakerSchema.parse({
        id: row.id,
        meetingId: row.meeting_id,
        displayName: row.display_name,
      }),
    )
  }

  beginTranscription(meetingId: string): Meeting {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(meetingId)
      assertMeetingTransition(meeting.status, 'transcribing')
      this.database
        .prepare("UPDATE meetings SET status = 'transcribing', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), meetingId)
      return this.requireById(meetingId)
    })
  }

  completeTranscription(
    meetingId: string,
    speakers: readonly Speaker[],
    segments: readonly TranscriptSegment[],
  ): { speakers: Speaker[]; segments: TranscriptSegment[] } {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(meetingId)
      assertMeetingTransition(meeting.status, 'summarizing')
      const upsertSpeaker = this.database.prepare(
        `INSERT INTO speakers (id, meeting_id, display_name) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name
         WHERE speakers.meeting_id = excluded.meeting_id`,
      )
      for (const value of speakers) {
        const speaker = SpeakerSchema.parse(value)
        if (speaker.meetingId !== meetingId) {
          throw new Error('Speaker belongs to a different meeting')
        }
        upsertSpeaker.run(speaker.id, speaker.meetingId, speaker.displayName)
      }

      this.database.prepare('DELETE FROM transcript_segments WHERE meeting_id = ?').run(meetingId)
      const insertSegment = this.database.prepare(
        `INSERT INTO transcript_segments (id, meeting_id, speaker_id, start_ms, end_ms, text)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      for (const value of segments) {
        const segment = TranscriptSegmentSchema.parse(value)
        if (segment.meetingId !== meetingId) {
          throw new Error('Transcript segment belongs to a different meeting')
        }
        insertSegment.run(
          segment.id,
          segment.meetingId,
          segment.speakerId,
          segment.startMs,
          segment.endMs,
          segment.text,
        )
      }
      this.database
        .prepare("UPDATE meetings SET status = 'summarizing', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), meetingId)
      return { speakers: this.listSpeakers(meetingId), segments: this.listTranscript(meetingId) }
    })
  }

  failTranscription(
    meetingId: string,
    error: { code: string; message: string; retryable: boolean },
  ): Meeting {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(meetingId)
      assertMeetingTransition(meeting.status, 'failed')
      const now = new Date().toISOString()
      this.database
        .prepare("UPDATE meetings SET status = 'failed', updated_at = ? WHERE id = ?")
        .run(now, meetingId)
      this.database.prepare(
        `INSERT INTO processing_attempts
          (id, meeting_id, stage, started_at, finished_at, succeeded, sanitized_error)
         VALUES (?, ?, 'transcription', ?, ?, 0, ?)`,
      ).run(randomUUID(), meetingId, now, now, JSON.stringify(error))
      return this.requireById(meetingId)
    })
  }
}
