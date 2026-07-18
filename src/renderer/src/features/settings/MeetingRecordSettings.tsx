import { InlineNotice } from '../../components/feedback/InlineNotice'
import { ActionBar } from '../../components/layout/ActionBar'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'

export function MeetingRecordSettings({
  error,
  onImport,
  onDismissError,
}: {
  error: string | null
  onImport(): void
  onDismissError(): void
}) {
  return (
    <section
      className="settings-section meeting-record-settings"
      aria-labelledby="meeting-record-settings-title"
    >
      <div className="settings-heading">
        <div>
          <p className="eyebrow">RECORDS</p>
          <h2 id="meeting-record-settings-title"><Icon name="import" />회의 기록 관리</h2>
        </div>
      </div>
      <div className="meeting-record-import">
        <div>
          <strong>다른 기기의 기록 가져오기</strong>
          <p>Mineloa에서 내보낸 회의 기록 파일(.nnote)을 이 기기로 가져옵니다.</p>
        </div>
        <ActionBar>
          <Button icon="import" type="button" onClick={onImport}>회의 기록 가져오기</Button>
        </ActionBar>
      </div>
      {error === null ? null : (
        <InlineNotice tone="error" title="회의 기록을 가져오지 못했습니다">
          <p>{error}</p>
          <ActionBar>
            <Button icon="retry" type="button" onClick={onImport}>가져오기 다시 시도</Button>
            <Button icon="close" variant="tertiary" type="button" onClick={onDismissError}>알림 닫기</Button>
          </ActionBar>
        </InlineNotice>
      )}
    </section>
  )
}
