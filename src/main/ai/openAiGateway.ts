import { createReadStream } from 'node:fs'
import OpenAI from 'openai'
import { z } from 'zod'
import type { CredentialStore } from '../credentials/credentialStore'
import { OpenAiError } from './openAiErrors'

export interface TranscriptionRequest {
  filePath: string
  model: 'gpt-4o-transcribe-diarize'
  responseFormat: 'diarized_json'
  chunkingStrategy: 'auto'
}

export interface ProviderTranscriptSegment {
  speaker: string
  startSeconds: number
  endSeconds: number
  text: string
}

export interface ProviderTranscription {
  durationSeconds: number
  segments: ProviderTranscriptSegment[]
}

export interface OpenAiGatewayPort {
  transcribe(request: TranscriptionRequest): Promise<ProviderTranscription>
}

export interface OpenAiTranscriptionClient {
  audio: { transcriptions: { create(input: unknown): Promise<unknown> } }
}

export type OpenAiTranscriptionClientFactory = (apiKey: string) => OpenAiTranscriptionClient

const createClient: OpenAiTranscriptionClientFactory = (apiKey) => new OpenAI({ apiKey })

const responseSchema = z.object({
  duration: z.number().finite().nonnegative(),
  segments: z.array(
    z.object({
      speaker: z.string().min(1),
      start: z.number().finite().nonnegative(),
      end: z.number().finite().nonnegative(),
      text: z.string(),
    }),
  ),
})

export class OpenAiGateway implements OpenAiGatewayPort {
  constructor(
    private readonly credentials: CredentialStore,
    private readonly clientFactory: OpenAiTranscriptionClientFactory = createClient,
  ) {}

  async transcribe(request: TranscriptionRequest): Promise<ProviderTranscription> {
    const apiKey = await this.credentials.get()
    if (apiKey === null) {
      throw new OpenAiError(
        'OPENAI_API_KEY_MISSING',
        'An OpenAI API key is required.',
        false,
      )
    }

    const response = await this.clientFactory(apiKey).audio.transcriptions.create({
      file: createReadStream(request.filePath),
      model: request.model,
      response_format: request.responseFormat,
      chunking_strategy: request.chunkingStrategy,
    })
    const parsed = responseSchema.safeParse(response)
    if (!parsed.success) {
      throw new OpenAiError('OPENAI_MALFORMED_RESPONSE', 'OpenAI returned an invalid transcription response.', false)
    }

    let previousStart = 0
    for (const segment of parsed.data.segments) {
      if (
        segment.end < segment.start ||
        segment.start < previousStart ||
        segment.end > parsed.data.duration + 0.001
      ) {
        throw new OpenAiError(
          'OPENAI_MALFORMED_RESPONSE',
          'OpenAI returned invalid transcription timestamps.',
          false,
        )
      }
      previousStart = segment.start
    }
    return {
      durationSeconds: parsed.data.duration,
      segments: parsed.data.segments.map((segment) => ({
        speaker: segment.speaker,
        startSeconds: segment.start,
        endSeconds: segment.end,
        text: segment.text,
      })),
    }
  }
}
