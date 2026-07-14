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

interface MeetingIpcMain {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

type MeetingRepositoryPort = Pick<MeetingRepository,
  'listRecent' | 'create' | 'requireById' | 'listSpeakers' | 'listTranscript' |
  'listSummarySections' | 'listActionItems' | 'renameSpeaker'>

const SpeakerIdSchema = z.string().trim().min(1).max(200)
const SpeakerNameSchema = z.string().trim().min(1).max(100)

function toPublicMeeting(meeting: Meeting): PublicMeeting {
  const { audioPath: _privatePath, ...publicFields } = meeting
  return PublicMeetingSchema.parse({ ...publicFields, hasAudio: meeting.audioPath !== null })
}

function getDocument(repository: MeetingRepositoryPort, meetingId: string): MeetingDocument {
  const meeting = repository.requireById(meetingId)
  if (meeting.status === 'deleted') throw new Error('Meeting was deleted')
  const publicMeeting = toPublicMeeting(meeting)
  return MeetingDocumentSchema.parse({
    meeting: publicMeeting,
    audioUrl: publicMeeting.hasAudio ? meetingMediaUrl(meeting.id) : null,
    speakers: repository.listSpeakers(meeting.id),
    transcript: repository.listTranscript(meeting.id),
    summarySections: repository.listSummarySections(meeting.id),
    actionItems: repository.listActionItems(meeting.id),
  })
}

export function registerMeetingHandlers(ipcMain: MeetingIpcMain, repository: MeetingRepositoryPort): void {
  ipcMain.handle('meetings:list', () => repository.listRecent().map(toPublicMeeting))
  ipcMain.handle('meetings:get', async (_event, rawId) => getDocument(repository, MeetingIdSchema.parse(rawId)))
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
}
