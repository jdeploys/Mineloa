import type { PublicMeeting } from '../../../../shared/contracts/meetingsApi'
import type { TemplatesApi } from '../../../../shared/contracts/template'
import { EmptyState } from '../../components/feedback/EmptyState'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { SurfaceCard } from '../../components/ui/SurfaceCard'
import { Icon, type IconName } from '../../components/ui/Icon'
import { RecordingPanel, type RecordingPanelControls } from '../recording/RecordingPanel'

interface DashboardProps {
  meetings: readonly PublicMeeting[]
  recordingControls: RecordingPanelControls
  onOpenMeeting(meetingId: string): void
  onNavigate(destination: 'all' | 'templates' | 'settings', originFocusKey?: string): void
  templates?: TemplatesApi
  onImport?(): void
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(value))
}

function formatDuration(durationMs: number): string {
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.floor((durationMs % 60_000) / 1_000)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function statusTone(status: PublicMeeting['status']): 'success' | 'warning' | 'danger' | 'active' {
  if (status === 'completed' || status === 'recorded') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'recording') return 'active'
  return 'warning'
}

function statusIcon(status: PublicMeeting['status']): IconName {
  if (status === 'completed' || status === 'recorded') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'recording') return 'recording'
  return 'warning'
}

export function Dashboard({ meetings, recordingControls, onOpenMeeting, onNavigate, templates }: DashboardProps) {
  return <main className="dashboard page-container">
      <span className="visually-hidden">Nnote</span>
      <SurfaceCard className="new-meeting-card" labelledBy="new-meeting-heading">
        <header className="card-heading">
          <p className="eyebrow">NEW MEETING</p>
          <h1 id="new-meeting-heading">새 회의</h1>
          <p>노트북 마이크로 녹음하고 이 기기에 안전하게 저장합니다.</p>
        </header>
        <RecordingPanel
          controls={recordingControls}
          templates={templates}
          settingsFocusKey="recording-settings"
          onNavigate={() => onNavigate('settings', 'recording-settings')}
        />
      </SurfaceCard>
      <SurfaceCard className="recent-card" labelledBy="recent-heading">
        <header className="section-heading">
          <div>
            <p className="eyebrow">LIBRARY</p>
            <h2 id="recent-heading">최근 기록</h2>
          </div>
          <span className="meeting-count">{meetings.length}</span>
        </header>
        {meetings.length === 0 ? <EmptyState title="최근 기록이 없습니다." description="첫 회의를 녹음하면 여기에 안전하게 모입니다." /> :
          <ul className="meeting-list">
            {meetings.map((meeting) => <li key={meeting.id}>
              <button className="meeting-row" data-focus-key={`meeting-${meeting.id}`} type="button" onClick={() => onOpenMeeting(meeting.id)}>
                <span className="meeting-copy">
                  <strong>{meeting.title}</strong>
                  <span>{formatDate(meeting.createdAt)} · {formatDuration(meeting.durationMs)}</span>
                </span>
                <span className="meeting-row-end">
                  <StatusBadge label={meeting.status} tone={statusTone(meeting.status)} icon={statusIcon(meeting.status)} />
                  <Icon name="forward" />
                </span>
              </button>
            </li>)}
          </ul>}
      </SurfaceCard>
    </main>
}
