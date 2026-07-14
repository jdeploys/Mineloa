import { z } from 'zod'
import type { ProcessingService } from '../ai/processingService'
import { ProcessingStatusSchema } from '../../shared/contracts/processing'

interface ProcessingIpcMain { handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void }
interface WindowSource { getAllWindows(): Array<{ webContents: { isDestroyed(): boolean; send(channel: string, value: unknown): void } }> }
type ProcessingPort = Pick<ProcessingService, 'process' | 'retry' | 'getStatus' | 'subscribe'>
const MeetingIdSchema = z.string().trim().min(1).max(200).regex(/^[\p{L}\p{N}._:-]+$/u)

export function registerProcessingHandlers(ipcMain: ProcessingIpcMain, service: ProcessingPort, windows: WindowSource): () => void {
  ipcMain.handle('processing:get-status', (_event, meetingId) => service.getStatus(MeetingIdSchema.parse(meetingId)))
  ipcMain.handle('processing:process', (_event, meetingId) => service.process(MeetingIdSchema.parse(meetingId)))
  ipcMain.handle('processing:retry', (_event, meetingId) => service.retry(MeetingIdSchema.parse(meetingId)))
  return service.subscribe((value) => {
    const status = ProcessingStatusSchema.parse(value)
    for (const window of windows.getAllWindows()) {
      if (!window.webContents.isDestroyed()) window.webContents.send('processing:progress', status)
    }
  })
}
