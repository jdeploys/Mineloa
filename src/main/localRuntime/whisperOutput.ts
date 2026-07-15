import type { NormalizedTranscription } from '../ai/providers/providerPorts'

const MAX_SEGMENTS = 100_000
const PINNED_TIMESTAMP = /^\d{2}:\d{2}:\d{2},\d{3}$/

interface PinnedWhisperOutput {
  result: { language: string }
  transcription: Array<{
    timestamps: { from: string; to: string }
    offsets: { from: number; to: number }
    text: string
  }>
}

function invalid(): never {
  throw new Error('Invalid pinned whisper.cpp output')
}

export function parseWhisperOutput(json: string, durationSeconds: number): NormalizedTranscription {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) return invalid()
  let value: unknown
  try { value = JSON.parse(json) } catch { return invalid() }
  if (typeof value !== 'object' || value === null) return invalid()
  const output = value as Partial<PinnedWhisperOutput>
  if (
    typeof output.result !== 'object' || output.result === null
    || typeof output.result.language !== 'string'
    || !Array.isArray(output.transcription)
    || output.transcription.length > MAX_SEGMENTS
  ) return invalid()

  let previousStart = 0
  const segments = output.transcription.map((raw) => {
    if (
      typeof raw !== 'object' || raw === null
      || typeof raw.timestamps !== 'object' || raw.timestamps === null
      || typeof raw.timestamps.from !== 'string' || typeof raw.timestamps.to !== 'string'
      || !PINNED_TIMESTAMP.test(raw.timestamps.from) || !PINNED_TIMESTAMP.test(raw.timestamps.to)
      || typeof raw.offsets !== 'object' || raw.offsets === null
    ) return invalid()
    const { from, to } = raw.offsets
    const text = typeof raw.text === 'string' ? raw.text.trim() : ''
    if (
      !Number.isSafeInteger(from) || !Number.isSafeInteger(to)
      || from < 0 || to < from || from < previousStart || to / 1_000 > durationSeconds + 0.001
      || text.length === 0
    ) return invalid()
    previousStart = from
    return { speakerLabel: null, startSeconds: from / 1_000, endSeconds: to / 1_000, text }
  })
  return { durationSeconds, segments }
}
