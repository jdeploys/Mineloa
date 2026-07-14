import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Speaker, TranscriptSegment } from '../../shared/contracts/meeting'
import type { MeetingRepository } from '../db/meetingRepository'
import { recordingFilePrefix } from '../recording/recordingPaths'
import type { OpenAiGatewayPort, ProviderTranscription } from './openAiGateway'
import { OpenAiError, toOpenAiError } from './openAiErrors'

export interface TranscriptionResult {
  speakers: Speaker[]
  segments: TranscriptSegment[]
}

function validateProviderTiming(response: ProviderTranscription): void {
  if (!Number.isFinite(response.durationSeconds) || response.durationSeconds < 0) {
    throw new OpenAiError('OPENAI_MALFORMED_RESPONSE', 'OpenAI returned an invalid transcription duration.', false)
  }
  let previousStart = 0
  for (const segment of response.segments) {
    if (
      !segment.speaker ||
      !Number.isFinite(segment.startSeconds) ||
      !Number.isFinite(segment.endSeconds) ||
      segment.startSeconds < previousStart ||
      segment.startSeconds < 0 ||
      segment.endSeconds < segment.startSeconds ||
      segment.endSeconds > response.durationSeconds + 0.001 ||
      typeof segment.text !== 'string'
    ) {
      throw new OpenAiError('OPENAI_MALFORMED_RESPONSE', 'OpenAI returned invalid transcription segments.', false)
    }
    previousStart = segment.startSeconds
  }
}

export class TranscriptionService {
  constructor(
    private readonly meetings: MeetingRepository,
    private readonly gateway: OpenAiGatewayPort,
    private readonly recordingsDirectory: string,
  ) {}

  async transcribeMeeting(meetingId: string): Promise<TranscriptionResult> {
    this.meetings.beginTranscription(meetingId)
    let paths: string[] = [this.recordingsDirectory]
    try {
      paths.push(...(await this.finalizedPartPaths(meetingId)))
      const speakers = new Map<string, Speaker>()
      const segments: TranscriptSegment[] = []
      let offsetSeconds = 0

      for (const [partIndex, filePath] of paths.slice(1).entries()) {
        const response = await this.gateway.transcribe({
          filePath,
          model: 'gpt-4o-transcribe-diarize',
          responseFormat: 'diarized_json',
          chunkingStrategy: 'auto',
        })
        validateProviderTiming(response)
        response.segments.forEach((segment, segmentIndex) => {
          const speakerId = `${partIndex}:${segment.speaker}`
          speakers.set(speakerId, {
            id: speakerId,
            meetingId,
            displayName: `Speaker ${segment.speaker}`,
          })
          segments.push({
            id: `${partIndex}:${segmentIndex}`,
            meetingId,
            speakerId,
            startMs: Math.round((offsetSeconds + segment.startSeconds) * 1_000),
            endMs: Math.round((offsetSeconds + segment.endSeconds) * 1_000),
            text: segment.text,
          })
        })
        offsetSeconds += response.durationSeconds
      }

      return this.meetings.completeTranscription(meetingId, [...speakers.values()], segments)
    } catch (error) {
      const typed = toOpenAiError(error, paths)
      this.meetings.failTranscription(meetingId, {
        code: typed.code,
        message: typed.message,
        retryable: typed.retryable,
      })
      throw typed
    }
  }

  private async finalizedPartPaths(meetingId: string): Promise<string[]> {
    const prefix = recordingFilePrefix(meetingId)
    const parts = (await readdir(this.recordingsDirectory))
      .map((name) => ({
        name,
        match: name.startsWith(prefix)
          ? name.slice(prefix.length).match(/^part-(\d+)\.webm$/)
          : null,
      }))
      .filter((entry): entry is { name: string; match: RegExpMatchArray } => entry.match !== null)
      .map(({ name, match }) => ({ name, index: Number(match[1]) }))
      .sort((left, right) => left.index - right.index)
    if (parts.length === 0 || parts.some((part, index) => part.index !== index)) {
      throw new OpenAiError('OPENAI_INVALID_AUDIO', 'Finalized recording parts are missing or incomplete.', false)
    }
    return parts.map(({ name }) => join(this.recordingsDirectory, name))
  }
}
