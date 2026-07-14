const MEBIBYTE = 1024 * 1024

export const RECORDING_WARNING_BYTES = 22 * MEBIBYTE
export const RECORDING_PART_LIMIT_BYTES = 24 * MEBIBYTE

export interface AppendChunkInput {
  meetingId: string
  partIndex: number
  chunkIndex: number
  durationMs: number
  bytes: Uint8Array
}

export interface RecordingProgress {
  totalBytes: number
  durationMs: number
  warn: boolean
  rolledToPartIndex: number | null
}

export interface RecordingSizePolicy {
  warn: boolean
  rollPart: boolean
}

export function evaluateRecordingSize(totalBytes: number): RecordingSizePolicy {
  return {
    warn: totalBytes >= RECORDING_WARNING_BYTES,
    rollPart: totalBytes >= RECORDING_PART_LIMIT_BYTES,
  }
}
