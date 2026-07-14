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
import {
  StoredActionItemSchema,
  StoredSummarySectionSchema,
  type StoredActionItem,
  type StoredSummarySection,
} from '../../shared/contracts/summary'
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

interface SummarySectionRow {
  id: string
  meeting_id: string
  template_section_id: string
  kind: string
  content_json: string
  order_index: number
}

interface ActionItemRow {
  id: string
  meeting_id: string
  content: string
  assignee_speaker_id: string | null
  due_at: string | null
  completed: number
}

export type ProcessingStage = 'transcribing' | 'summarizing' | 'cleanup'

export interface ProcessingAttempt {
  id: string
  meetingId: string
  stage: ProcessingStage
  startedAt: string
  finishedAt: string | null
  succeeded: boolean | null
  error: { code: string; message: string; retryable: boolean } | null
}

interface ProcessingAttemptRow {
  id: string
  meeting_id: string
  stage: string
  started_at: string
  finished_at: string | null
  succeeded: number | null
  sanitized_error: string | null
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

  renameSpeaker(meetingId: string, speakerId: string, displayName: string): Speaker {
    const name = displayName.trim()
    if (name.length === 0) throw new Error('Speaker display name is required')
    return inTransaction(this.database, () => {
      const result = this.database
        .prepare('UPDATE speakers SET display_name = ? WHERE meeting_id = ? AND id = ?')
        .run(name, meetingId, speakerId)
      if (result.changes !== 1) throw new Error(`Speaker ${speakerId} was not found`)
      return this.listSpeakers(meetingId).find(({ id }) => id === speakerId)!
    })
  }

  replaceSummary(
    meetingId: string,
    sections: readonly Omit<StoredSummarySection, 'id' | 'meetingId'>[],
    actionItems: readonly Omit<StoredActionItem, 'id' | 'meetingId' | 'completed'>[],
  ): { sections: StoredSummarySection[]; actionItems: StoredActionItem[] } {
    return inTransaction(this.database, () => {
      this.requireById(meetingId)
      this.writeSummary(meetingId, sections, actionItems)
      return { sections: this.listSummarySections(meetingId), actionItems: this.listActionItems(meetingId) }
    })
  }

  completeSummary(
    meetingId: string,
    sections: readonly Omit<StoredSummarySection, 'id' | 'meetingId'>[],
    actionItems: readonly Omit<StoredActionItem, 'id' | 'meetingId' | 'completed'>[],
  ): { sections: StoredSummarySection[]; actionItems: StoredActionItem[] } {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(meetingId)
      assertMeetingTransition(meeting.status, 'completed')
      this.writeSummary(meetingId, sections, actionItems)
      this.database.prepare("UPDATE meetings SET status = 'completed', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), meetingId)
      return { sections: this.listSummarySections(meetingId), actionItems: this.listActionItems(meetingId) }
    })
  }

  private writeSummary(
    meetingId: string,
    sections: readonly Omit<StoredSummarySection, 'id' | 'meetingId'>[],
    actionItems: readonly Omit<StoredActionItem, 'id' | 'meetingId' | 'completed'>[],
  ): void {
      this.database.prepare('DELETE FROM action_items WHERE meeting_id = ?').run(meetingId)
      this.database.prepare('DELETE FROM summary_sections WHERE meeting_id = ?').run(meetingId)
      const insertSection = this.database.prepare(
        `INSERT INTO summary_sections
          (id, meeting_id, template_section_id, kind, content_json, order_index)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      for (const value of sections) {
        const section = StoredSummarySectionSchema.parse({ ...value, id: randomUUID(), meetingId })
        insertSection.run(section.id, meetingId, section.templateSectionId, section.kind, JSON.stringify({ text: section.text, items: section.items }), section.orderIndex)
      }
      const insertAction = this.database.prepare(
        `INSERT INTO action_items
          (id, meeting_id, content, assignee_speaker_id, due_at, completed)
         VALUES (?, ?, ?, ?, ?, 0)`,
      )
      for (const value of actionItems) {
        const item = StoredActionItemSchema.parse({ ...value, id: randomUUID(), meetingId, completed: false })
        insertAction.run(item.id, meetingId, item.content, item.assigneeSpeakerId, item.dueAt)
      }
  }

  beginSummarization(meetingId: string): Meeting {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(meetingId)
      if (meeting.status === 'summarizing') return meeting
      assertMeetingTransition(meeting.status, 'summarizing')
      this.database.prepare("UPDATE meetings SET status = 'summarizing', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), meetingId)
      return this.requireById(meetingId)
    })
  }

  beginProcessingAttempt(meetingId: string, stage: ProcessingStage): ProcessingAttempt {
    this.requireById(meetingId)
    const id = randomUUID()
    const startedAt = new Date().toISOString()
    this.database.prepare(
      `INSERT INTO processing_attempts (id, meeting_id, stage, started_at, finished_at, succeeded, sanitized_error)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL)`,
    ).run(id, meetingId, stage, startedAt)
    return this.latestProcessingAttempt(meetingId)!
  }

  finishProcessingAttempt(
    id: string,
    outcome: { succeeded: true } | { succeeded: false; error: { code: string; message: string; retryable: boolean } },
  ): void {
    const result = this.database.prepare(
      `UPDATE processing_attempts SET finished_at = ?, succeeded = ?, sanitized_error = ?
       WHERE id = ? AND finished_at IS NULL`,
    ).run(
      new Date().toISOString(),
      outcome.succeeded ? 1 : 0,
      outcome.succeeded ? null : JSON.stringify(outcome.error),
      id,
    )
    if (result.changes !== 1) throw new Error('Processing attempt is not active')
  }

  latestProcessingAttempt(meetingId: string): ProcessingAttempt | null {
    const row = this.database.prepare(
      'SELECT * FROM processing_attempts WHERE meeting_id = ? ORDER BY rowid DESC LIMIT 1',
    ).get(meetingId) as ProcessingAttemptRow | undefined
    if (row === undefined) return null
    if (!['transcribing', 'summarizing', 'cleanup'].includes(row.stage)) return null
    return {
      id: row.id,
      meetingId: row.meeting_id,
      stage: row.stage as ProcessingStage,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      succeeded: row.succeeded === null ? null : row.succeeded === 1,
      error: row.sanitized_error === null ? null : JSON.parse(row.sanitized_error),
    }
  }

  failProcessing(meetingId: string): Meeting {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(meetingId)
      if (meeting.status === 'failed') return meeting
      assertMeetingTransition(meeting.status, 'failed')
      this.database.prepare("UPDATE meetings SET status = 'failed', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), meetingId)
      return this.requireById(meetingId)
    })
  }

  completeAudioCleanup(meetingId: string, attemptId: string): Meeting {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(meetingId)
      if (meeting.status !== 'completed') throw new Error('Audio cleanup requires completed processing')
      this.database.prepare('UPDATE meetings SET audio_path = NULL, audio_byte_count = 0, updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), meetingId)
      const result = this.database.prepare(
        `UPDATE processing_attempts SET finished_at = ?, succeeded = 1, sanitized_error = NULL
         WHERE id = ? AND meeting_id = ? AND stage = 'cleanup' AND finished_at IS NULL`,
      ).run(new Date().toISOString(), attemptId, meetingId)
      if (result.changes !== 1) throw new Error('Cleanup attempt is not active')
      return this.requireById(meetingId)
    })
  }

  listSummarySections(meetingId: string): StoredSummarySection[] {
    const rows = this.database.prepare(
      'SELECT * FROM summary_sections WHERE meeting_id = ? ORDER BY order_index, id',
    ).all(meetingId) as SummarySectionRow[]
    return rows.map((row) => {
      const content = JSON.parse(row.content_json) as { text?: unknown; items?: unknown }
      return StoredSummarySectionSchema.parse({
        id: row.id,
        meetingId: row.meeting_id,
        templateSectionId: row.template_section_id,
        kind: row.kind,
        text: content.text,
        items: content.items,
        orderIndex: row.order_index,
      })
    })
  }

  listActionItems(meetingId: string): StoredActionItem[] {
    const rows = this.database.prepare(
      'SELECT * FROM action_items WHERE meeting_id = ? ORDER BY rowid',
    ).all(meetingId) as ActionItemRow[]
    return rows.map((row) => StoredActionItemSchema.parse({
      id: row.id,
      meetingId: row.meeting_id,
      content: row.content,
      assigneeSpeakerId: row.assignee_speaker_id,
      dueAt: row.due_at,
      completed: row.completed === 1,
    }))
  }

  beginTranscription(meetingId: string): Meeting {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(meetingId)
      if (meeting.status === 'transcribing') return meeting
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
         ON CONFLICT(id) DO NOTHING`,
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
      const active = this.database.prepare(
        `SELECT id FROM processing_attempts
         WHERE meeting_id = ? AND stage = 'transcribing' AND finished_at IS NULL
         ORDER BY rowid DESC LIMIT 1`,
      ).get(meetingId)
      if (active === undefined) {
        this.database.prepare(
          `INSERT INTO processing_attempts
            (id, meeting_id, stage, started_at, finished_at, succeeded, sanitized_error)
           VALUES (?, ?, 'transcription', ?, ?, 0, ?)`,
        ).run(randomUUID(), meetingId, now, now, JSON.stringify(error))
      }
      return this.requireById(meetingId)
    })
  }
}
