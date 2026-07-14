import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DesktopApi } from '../../shared/contracts/desktopApi'
import type { MeetingDocument, PublicMeeting } from '../../shared/contracts/meetingsApi'
import type { RecoveryItem } from '../../shared/contracts/recovery'
import { Dashboard } from './features/meetings/Dashboard'
import { MeetingDetail } from './features/meetings/MeetingDetail'
import { MediaRecorderController } from './features/recording/mediaRecorderController'
import { RecoveryDialog } from './features/recording/RecoveryDialog'
import { ApiKeySettings } from './features/settings/ApiKeySettings'
import { TemplateEditor } from './features/templates/TemplateEditor'

type Screen = 'all' | 'templates' | 'settings' | 'detail'
type RecordingControllerPort = Pick<MediaRecorderController, 'start' | 'stop' | 'discard'>

export function App({
  desktopApi = window.desktopApi,
  recordingController,
}: {
  desktopApi?: DesktopApi
  recordingController?: RecordingControllerPort
} = {}) {
  const [recoveries, setRecoveries] = useState<RecoveryItem[] | null>(null)
  const [meetings, setMeetings] = useState<PublicMeeting[]>([])
  const [document, setDocument] = useState<MeetingDocument | null>(null)
  const [screen, setScreen] = useState<Screen>('all')
  const [error, setError] = useState<string | null>(null)
  const routeHeading = useRef<HTMLHeadingElement>(null)
  const returnFocusKey = useRef<string | null>(null)
  const controller = useMemo(
    () => recordingController ?? new MediaRecorderController(desktopApi.recording),
    [desktopApi, recordingController],
  )

  const refreshMeetings = useCallback(async () => {
    if (desktopApi.meetings === undefined) return
    setMeetings(await desktopApi.meetings.list())
  }, [desktopApi])

  useEffect(() => {
    let current = true
    void desktopApi.recovery.scan().then(async (items) => {
      if (!current) return
      setRecoveries(items)
      await refreshMeetings()
    }).catch((cause) => {
      if (current) setError(cause instanceof Error ? cause.message : '중단된 녹음을 확인하지 못했습니다.')
    })
    return () => { current = false }
  }, [desktopApi, refreshMeetings])

  useEffect(() => {
    if (screen !== 'all') {
      routeHeading.current?.focus()
      return
    }
    const key = returnFocusKey.current
    if (key === null) return
    documentQuery(`[data-focus-key="${key.replace(/["\\]/g, '')}"]`)?.focus()
    returnFocusKey.current = null
  }, [screen, document])

  const recordingControls = useMemo(() => ({
    start: async () => {
      const created = await desktopApi.meetings.createRecording({
        title: `새 회의 ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date())}`,
        audioPolicy: 'delete_after_processing', selectedTemplateId: null,
      })
      try {
        await controller.start(created.id)
      } catch (startError) {
        try {
          await desktopApi.meetings.cancelEmptyRecording(created.id, { explicitDelete: true })
        } catch (cleanupError) {
          throw new AggregateError([startError, cleanupError], '녹음 시작 실패 후 빈 기록을 정리하지 못했습니다.')
        } finally {
          await refreshMeetings()
        }
        throw startError
      }
      await refreshMeetings()
    },
    stop: async () => { await controller.stop(); await refreshMeetings() },
    discard: async () => { await controller.discard(); await refreshMeetings() },
  }), [controller, desktopApi, refreshMeetings])

  function navigate(destination: 'all' | 'templates' | 'settings') {
    if (destination !== 'all') returnFocusKey.current = `nav-${destination}`
    setScreen(destination)
  }

  async function openMeeting(meetingId: string) {
    try {
      returnFocusKey.current = `meeting-${meetingId}`
      setDocument(await desktopApi.meetings.get(meetingId))
      setScreen('detail')
      setError(null)
    } catch (cause) {
      returnFocusKey.current = null
      setError(cause instanceof Error ? cause.message : '회의 기록을 열지 못했습니다.')
    }
  }

  function backToAll() { setScreen('all') }

  if (error !== null) return <main className="document-shell" role="alert">복구 또는 기록 확인에 실패했습니다. 새 녹음을 시작하지 않았습니다: {error}</main>
  if (recoveries === null) return <main className="document-shell" aria-busy="true">복구 확인 중</main>
  if (recoveries.length > 0) return <RecoveryDialog
    items={recoveries}
    recovery={desktopApi.recovery}
    onResolved={(meetingId) => {
      setRecoveries((items) => items?.filter((item) => item.meetingId !== meetingId) ?? [])
      void refreshMeetings()
    }}
  />

  return <>
    <div hidden={screen !== 'all'}>
      <Dashboard meetings={meetings} recordingControls={recordingControls} onOpenMeeting={(id) => void openMeeting(id)} onNavigate={navigate} />
    </div>
    {screen === 'detail' && document !== null && <MeetingDetail
      document={document}
      headingRef={routeHeading}
      onBack={backToAll}
      onRenameSpeaker={desktopApi.meetings.renameSpeaker}
    />}
    {screen === 'settings' && <main className="document-shell">
      <button className="back-button" onClick={backToAll}>← 전체 기록</button>
      <h1 ref={routeHeading} tabIndex={-1}>설정</h1>
      <ApiKeySettings settings={desktopApi.settings} />
    </main>}
    {screen === 'templates' && <main className="document-shell">
      <button className="back-button" onClick={backToAll}>← 전체 기록</button>
      <h1 ref={routeHeading} tabIndex={-1}>요약 템플릿</h1>
      <TemplateEditor templates={desktopApi.templates} />
    </main>}
  </>
}

function documentQuery(selector: string): HTMLElement | null {
  return globalThis.document?.querySelector<HTMLElement>(selector) ?? null
}
