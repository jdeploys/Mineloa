import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Meeting } from '../../shared/contracts/meeting'
import {
  CreateRecordingMeetingInputSchema,
  MeetingDocumentSchema,
  MeetingIdSchema,
  PublicMeetingSchema,
  type MeetingDocument,
  type PublicMeeting,
} from '../../shared/contracts/meetingsApi'
import type { MeetingRepository } from '../db/meetingRepository'
import { meetingMediaUrl } from '../media/registerMediaProtocol'
import type { TemplateService } from '../templates/templateService'
import { DEFAULT_TEMPLATE_ID } from '../templates/defaultTemplate'

interface MeetingIpcMain {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

type MeetingRepositoryPort = Pick<MeetingRepository,
  'listRecent' | 'create' | 'requireById' | 'listSpeakers' | 'listTranscript' |
  'listSummarySections' | 'listActionItems' | 'renameSpeaker' | 'discardRecording'>
type TemplateServicePort = Pick<TemplateService, 'get'>

const SpeakerIdSchema = z.string().trim().min(1).max(200)
const SpeakerNameSchema = z.string().trim().min(1).max(100)
const ExplicitDeleteSchema = z.object({ explicitDelete: z.literal(true) }).strict()

function toPublicMeeting(meeting: Meeting): PublicMeeting {
  const { audioPath: _privatePath, ...publicFields } = meeting
  return PublicMeetingSchema.parse({ ...publicFields, hasAudio: meeting.audioPath !== null })
}

function getDocument(repository: MeetingRepositoryPort, templates: TemplateServicePort, meetingId: string): MeetingDocument {
  const meeting = repository.requireById(meetingId)
  if (meeting.status === 'deleted') throw new Error('Meeting was deleted')
  const publicMeeting = toPublicMeeting(meeting)
  const template = templates.get(meeting.selectedTemplateId ?? DEFAULT_TEMPLATE_ID)
  const sectionTitles = new Map(template.sections.map((section) => [section.id, section.title]))
  return MeetingDocumentSchema.parse({
    meeting: publicMeeting,
    audioUrl: publicMeeting.hasAudio ? meetingMediaUrl(meeting.id) : null,
    speakers: repository.listSpeakers(meeting.id),
    transcript: repository.listTranscript(meeting.id),
    summarySections: repository.listSummarySections(meeting.id).map((section) => ({
      ...section,
      title: sectionTitles.get(section.templateSectionId) ?? '요약 섹션',
    })),
    actionItems: repository.listActionItems(meeting.id),
  })
}

export function registerMeetingHandlers(ipcMain: MeetingIpcMain, repository: MeetingRepositoryPort, templates: TemplateServicePort): void {
  ipcMain.handle('meetings:list', () => repository.listRecent().map(toPublicMeeting))
  ipcMain.handle('meetings:get', async (_event, rawId) => getDocument(repository, templates, MeetingIdSchema.parse(rawId)))
  ipcMain.handle('meetings:create-recording', async (_event, rawInput) => {
    const input = CreateRecordingMeetingInputSchema.parse(rawInput)
    const now = new Date().toISOString()
    return toPublicMeeting(repository.create({
      id: randomUUID(), title: input.title, createdAt: now, updatedAt: now,
      durationMs: 0, status: 'recording', audioPolicy: input.audioPolicy,
      audioPath: null, audioByteCount: 0, selectedTemplateId: input.selectedTemplateId,
    }))
  })
  ipcMain.handle('meetings:rename-speaker', async (_event, rawMeetingId, rawSpeakerId, rawDisplayName) =>
    repository.renameSpeaker(
      MeetingIdSchema.parse(rawMeetingId),
      SpeakerIdSchema.parse(rawSpeakerId),
      SpeakerNameSchema.parse(rawDisplayName),
    ),
  )
  ipcMain.handle('meetings:cancel-empty-recording', async (_event, rawMeetingId, rawOptions) => {
    const meetingId = MeetingIdSchema.parse(rawMeetingId)
    ExplicitDeleteSchema.parse(rawOptions)
    const meeting = repository.requireById(meetingId)
    if (meeting.status !== 'recording' || meeting.audioPath !== null || meeting.audioByteCount !== 0) {
      throw new Error('Only an empty failed-start recording can be removed')
    }
    repository.discardRecording(meetingId)
  })
}
