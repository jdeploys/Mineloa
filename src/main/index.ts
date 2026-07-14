import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import { join } from 'node:path'
import { OpenAiKeyValidator } from './ai/openAiKeyValidator'
import { OpenAiGateway, OpenAiSummaryGateway } from './ai/openAiGateway'
import { TranscriptionService } from './ai/transcriptionService'
import { SummaryService } from './ai/summaryService'
import { ProcessingService } from './ai/processingService'
import { KeyringCredentialStore } from './credentials/keyringCredentialStore'
import { openDatabase } from './db/database'
import { MeetingRepository } from './db/meetingRepository'
import { TemplateRepository } from './db/templateRepository'
import { registerRecordingHandlers } from './ipc/registerRecordingHandlers'
import { registerRecoveryHandlers } from './ipc/registerRecoveryHandlers'
import { registerSettingsHandlers } from './ipc/registerSettingsHandlers'
import { registerTemplateHandlers } from './ipc/registerTemplateHandlers'
import { registerProcessingHandlers } from './ipc/registerProcessingHandlers'
import { RecordingService } from './recording/recordingService'
import { RecoveryService } from './recording/recoveryService'
import { createMainWindow } from './window/createMainWindow'
import { TemplateService } from './templates/templateService'
import { startSingleInstanceApp } from './app/singleInstance'
import { registerMediaProtocol } from './media/registerMediaProtocol'
import { registerMeetingHandlers } from './ipc/registerMeetingHandlers'
import { registerArchiveHandlers } from './ipc/registerArchiveHandlers'
import { reconcileImportJournals } from './archive/importMeeting'

protocol.registerSchemesAsPrivileged([{
  scheme: 'nnote-media',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}])

startSingleInstanceApp(app, BrowserWindow, () => {
  const credentialStore = new KeyringCredentialStore()
  registerSettingsHandlers(ipcMain, credentialStore, new OpenAiKeyValidator())

  app.whenReady().then(async () => {
    const userDataDirectory = app.getPath('userData')
    const database = openDatabase(join(userDataDirectory, 'nnote.sqlite'))
    const meetings = new MeetingRepository(database)
    const recordingsDirectory = join(userDataDirectory, 'recordings')
    try {
      await reconcileImportJournals(database, recordingsDirectory)
    } catch {
      dialog.showErrorBox('Nnote 가져오기 복구 필요', '완료되지 않은 가져오기 기록을 안전하게 복구하지 못했습니다. 파일은 보존되었습니다.')
      database.close()
      return
    }
    const recordingService = new RecordingService(meetings, recordingsDirectory)
    const templateRepository = new TemplateRepository(database)
    const templateService = new TemplateService(templateRepository)
    templateService.seedDefault()
    registerTemplateHandlers(ipcMain, templateService)
    registerRecordingHandlers(ipcMain, recordingService)
    registerRecoveryHandlers(
      ipcMain,
      new RecoveryService(new MeetingRepository(database), recordingService, recordingsDirectory),
    )
    const processingService = new ProcessingService(
      meetings,
      new TranscriptionService(meetings, new OpenAiGateway(credentialStore), recordingsDirectory),
      new SummaryService(meetings, templateService, new OpenAiSummaryGateway(credentialStore)),
      recordingsDirectory,
    )
    registerProcessingHandlers(ipcMain, processingService)
    registerMeetingHandlers(ipcMain, meetings, templateService)
    registerArchiveHandlers(ipcMain, dialog, meetings, templateRepository, database, recordingsDirectory)
    registerMediaProtocol(protocol, meetings, recordingsDirectory)

    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
})
