import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MeetingDocument, PublicMeeting } from '../../shared/contracts/meetingsApi'
import type { RecoveryItem } from '../../shared/contracts/recovery'
import { Dashboard } from './features/meetings/Dashboard'
import { MeetingDetail } from './features/meetings/MeetingDetail'
import { MediaRecorderController } from './features/recording/mediaRecorderController'
import { RecoveryDialog } from './features/recording/RecoveryDialog'
import { ApiKeySettings } from './features/settings/ApiKeySettings'
import { TemplateEditor } from './features/templates/TemplateEditor'

type Screen = 'all' | 'templates' | 'settings' | 'detail'

export function App() {
  const [recoveries, setRecoveries] = useState<RecoveryItem[] | null>(null)
  const [meetings, setMeetings] = useState<PublicMeeting[]>([])
  const [document, setDocument] = useState<MeetingDocument | null>(null)
  const [screen, setScreen] = useState<Screen>('all')
  const [error, setError] = useState<string | null>(null)
  const controller = useMemo(() => new MediaRecorderController(window.desktopApi.recording), [])

  const refreshMeetings = useCallback(async () => {
    if (window.desktopApi.meetings === undefined) return
    setMeetings(await window.desktopApi.meetings.list())
  }, [])

  useEffect(() => {
    let current = true
    void window.desktopApi.recovery.scan().then(async (items) => {
      if (!current) return
      setRecoveries(items)
      await refreshMeetings()
    }).catch((cause) => {
      if (current) setError(cause instanceof Error ? cause.message : '중단된 녹음을 확인하지 못했습니다.')
    })
    return () => { current = false }
  }, [refreshMeetings])

  const recordingControls = useMemo(() => ({
    start: async () => {
      const created = await window.desktopApi.meetings.createRecording({
        title: `새 회의 ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date())}`,
        audioPolicy: 'delete_after_processing', selectedTemplateId: null,
      })
      try { await controller.start(created.id) }
      finally { await refreshMeetings() }
    },
    stop: async () => {
      await controller.stop()
      await refreshMeetings()
    },
    discard: async () => {
      await controller.discard()
      await refreshMeetings()
    },
  }), [controller, refreshMeetings])

  async function openMeeting(meetingId: string) {
    try {
      setDocument(await window.desktopApi.meetings.get(meetingId))
      setScreen('detail')
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '회의 기록을 열지 못했습니다.')
    }
  }

  if (error !== null) {
    return <main className="document-shell" role="alert">복구 또는 기록 확인에 실패했습니다. 새 녹음을 시작하지 않았습니다: {error}</main>
  }
  if (recoveries === null) return <main className="document-shell" aria-busy="true">복구 확인 중</main>

  if (recoveries.length > 0) {
    return <RecoveryDialog
      items={recoveries}
      recovery={window.desktopApi.recovery}
      onResolved={(meetingId) => {
        setRecoveries((items) => items?.filter((item) => item.meetingId !== meetingId) ?? [])
        void refreshMeetings()
      }}
    />
  }

  if (screen === 'detail' && document !== null) {
    return <MeetingDetail
      document={document}
      onBack={() => { setScreen('all'); setDocument(null); void refreshMeetings() }}
      onRenameSpeaker={window.desktopApi.meetings.renameSpeaker}
    />
  }

  if (screen === 'settings') return <main className="document-shell"><button className="back-button" onClick={() => setScreen('all')}>← 전체 기록</button><ApiKeySettings settings={window.desktopApi.settings} /></main>
  if (screen === 'templates') return <main className="document-shell"><button className="back-button" onClick={() => setScreen('all')}>← 전체 기록</button><TemplateEditor templates={window.desktopApi.templates} /></main>

  return <Dashboard
    meetings={meetings}
    recordingControls={recordingControls}
    onOpenMeeting={(meetingId) => void openMeeting(meetingId)}
    onNavigate={(destination) => setScreen(destination)}
  />
}
