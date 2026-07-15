import type { WhisperModelProgress } from '../../shared/contracts/settings'

interface ProgressWebContents {
  isDestroyed(): boolean
  send(channel: string, progress: WhisperModelProgress): void
}

interface ProgressWindow {
  isDestroyed(): boolean
  webContents: ProgressWebContents
}

export function publishWhisperProgressToLiveWindows(
  windows: readonly ProgressWindow[],
  progress: WhisperModelProgress,
): void {
  for (const window of windows) {
    try {
      if (!window.isDestroyed()) {
        const webContents = window.webContents
        if (!webContents.isDestroyed()) {
          webContents.send('settings:whisper-model-progress', progress)
        }
      }
    } catch {
      // Destruction can race any access; another live window should still receive progress.
    }
  }
}
