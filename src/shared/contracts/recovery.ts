import type { RecordingProgress } from './recording'

export interface RecoveryItem {
  meetingId: string
  createdAt: string
  durationMs: number
  byteCount: number
  kind: 'recoverable' | 'finalizeOnly' | 'exportOnly'
}

export interface RecoveryApi {
  scan(): Promise<RecoveryItem[]>
  recover(meetingId: string): Promise<RecordingProgress>
  keepAsFile(meetingId: string): Promise<void>
  discard(meetingId: string, options: { explicitDelete: true }): Promise<void>
}
