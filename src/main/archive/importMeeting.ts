import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { basename } from 'node:path'
import type Database from 'better-sqlite3'
import { completedPartPath } from '../recording/recordingPaths'
import { parseArchive } from './archiveSchema'

export interface ImportedMeetingResult { meetingId: string; importedAudio: boolean }

export async function importMeetingArchive(bytes: Uint8Array, database: Database.Database, recordingsDirectory: string): Promise<ImportedMeetingResult> {
  const archive = parseArchive(bytes)
  const meetingId = randomUUID()
  const speakerIds = new Map(archive.transcript.speakers.map((speaker) => [speaker.id, randomUUID()]))
  for (const segment of archive.transcript.segments) {
    if (segment.speakerId !== null && !speakerIds.has(segment.speakerId)) throw new Error('Transcript references an unknown speaker')
  }
  for (const item of archive.summary.actionItems) {
    if (item.assigneeSpeakerId !== null && !speakerIds.has(item.assigneeSpeakerId)) throw new Error('Action item references an unknown speaker')
  }

  let templateId: string | null = null
  const sectionIds = new Map<string, string>()
  if (archive.meeting.template !== null) {
    templateId = randomUUID()
    for (const section of archive.meeting.template.sections) sectionIds.set(section.id, randomUUID())
    for (const section of archive.summary.sections) if (!sectionIds.has(section.templateSectionId)) throw new Error('Summary references an unknown template section')
  } else if (archive.summary.sections.length > 0) {
    throw new Error('Summary sections require an archived template snapshot')
  }

  await mkdir(recordingsDirectory, { recursive: true })
  const finalPath = archive.audio === null ? null : completedPartPath(recordingsDirectory, meetingId, 0)
  const temporaryPath = finalPath === null ? null : `${finalPath}.${randomUUID()}.importing`
  try {
    if (archive.audio !== null && temporaryPath !== null && finalPath !== null) {
      const handle = await open(temporaryPath, 'wx')
      try { await handle.writeFile(archive.audio); await handle.sync() } finally { await handle.close() }
      await rename(temporaryPath, finalPath)
    }

    database.exec('BEGIN IMMEDIATE')
    try {
      const now = new Date().toISOString()
      if (archive.meeting.template !== null && templateId !== null) {
        const sections = archive.meeting.template.sections.map((section) => ({ ...section, id: sectionIds.get(section.id)! }))
        database.prepare('INSERT INTO summary_templates (id, name, sections_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(templateId, `${archive.meeting.template.name} (가져옴)`, JSON.stringify(sections), now, now)
      }
      database.prepare(`INSERT INTO meetings (id, title, created_at, updated_at, duration_ms, status, audio_policy, audio_path, audio_byte_count, selected_template_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(meetingId, archive.meeting.title, archive.meeting.createdAt, archive.meeting.updatedAt, archive.meeting.durationMs,
          archive.meeting.status, archive.meeting.audioPolicy, finalPath === null ? null : basename(finalPath), archive.audio?.byteLength ?? 0, templateId)
      if (finalPath !== null && archive.audio !== null) database.prepare('INSERT INTO recording_parts (meeting_id, part_index, relative_path, byte_count, duration_ms) VALUES (?, 0, ?, ?, ?)')
        .run(meetingId, basename(finalPath), archive.audio.byteLength, archive.meeting.durationMs)
      for (const speaker of archive.transcript.speakers) database.prepare('INSERT INTO speakers (id, meeting_id, display_name) VALUES (?, ?, ?)')
        .run(speakerIds.get(speaker.id), meetingId, speaker.displayName)
      for (const segment of archive.transcript.segments) database.prepare('INSERT INTO transcript_segments (id, meeting_id, speaker_id, start_ms, end_ms, text) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), meetingId, segment.speakerId === null ? null : speakerIds.get(segment.speakerId), segment.startMs, segment.endMs, segment.text)
      for (const section of archive.summary.sections) database.prepare('INSERT INTO summary_sections (id, meeting_id, template_section_id, kind, content_json, order_index) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), meetingId, sectionIds.get(section.templateSectionId), section.kind, JSON.stringify({ text: section.text, items: section.items }), section.orderIndex)
      for (const item of archive.summary.actionItems) database.prepare('INSERT INTO action_items (id, meeting_id, content, assignee_speaker_id, due_at, completed) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), meetingId, item.content, item.assigneeSpeakerId === null ? null : speakerIds.get(item.assigneeSpeakerId), item.dueAt, item.completed ? 1 : 0)
      database.exec('COMMIT')
    } catch (error) { database.exec('ROLLBACK'); throw error }
    return { meetingId, importedAudio: archive.audio !== null }
  } catch (error) {
    if (temporaryPath !== null) await rm(temporaryPath, { force: true }).catch(() => undefined)
    if (finalPath !== null) await rm(finalPath, { force: true }).catch(() => undefined)
    throw error
  }
}
