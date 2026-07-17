import { useState } from 'react'
import type { RecoveryItem } from '../../../../shared/contracts/recovery'
import { InlineNotice } from '../../components/feedback/InlineNotice'
import { ActionBar } from '../../components/layout/ActionBar'
import { Button } from '../../components/ui/Button'
import { StatusBadge } from '../../components/ui/StatusBadge'

interface RecoveryControls {
  recover(meetingId: string): Promise<unknown>
  keepAsFile(meetingId: string): Promise<unknown>
  discard(meetingId: string, options: { explicitDelete: true }): Promise<unknown>
  exportOnly?(meetingId: string): Promise<{ status: 'success' | 'cancelled' | 'failure'; message?: string }>
}

interface RecoveryDialogProps {
  items: readonly RecoveryItem[]
  recovery: RecoveryControls
  onResolved(meetingId: string): void
  onRecover?(meetingId: string): Promise<void>
  recoverDisabled?: boolean
}

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1_000)
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`
}

function formatBytes(byteCount: number): string {
  if (byteCount < 1_024) return `${byteCount} B`
  return `${Math.round(byteCount / 1_024)} KB`
}

function recoveryLabel(kind: RecoveryItem['kind']): string {
  if (kind === 'recoverable') return '복구 가능'
  if (kind === 'finalizeOnly') return '파일 보관 가능'
  return '원본 보존'
}

export function RecoveryDialog({ items, recovery, onResolved, onRecover, recoverDisabled = false }: RecoveryDialogProps) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (items.length === 0) return null

  const decide = async (meetingId: string, action: 'recover' | 'keep' | 'discard') => {
    setBusy(true)
    setError(null)
    try {
      if (action === 'recover') {
        if (onRecover === undefined) await recovery.recover(meetingId)
        else await onRecover(meetingId)
      }
      else if (action === 'keep') await recovery.keepAsFile(meetingId)
      else await recovery.discard(meetingId, { explicitDelete: true })
      setConfirming(null)
      onResolved(meetingId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '복구 결정을 적용하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const exportBytes = async (meetingId: string) => {
    setBusy(true)
    setError(null)
    try {
      const result = await recovery.exportOnly?.(meetingId)
      if (result?.status === 'failure') setError(result.message ?? '보존 바이트를 내보내지 못했습니다.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '보존 바이트를 내보내지 못했습니다.')
    } finally { setBusy(false) }
  }

  return (
    <div className="dialog-scrim">
      <div className="dialog-panel recovery-panel" role="dialog" aria-modal="true" aria-label="중단된 녹음 복구">
        <header className="dialog-heading">
          <p className="eyebrow">RECOVERY</p>
          <h1>중단된 녹음 복구</h1>
          <p>모든 항목을 처리할 때까지 새 녹음을 시작할 수 없습니다.</p>
        </header>
        <div className="recovery-list">
          {items.map((item) => (
            <section className="recovery-item" key={item.meetingId} aria-label={`중단된 녹음 ${item.meetingId}`}>
              <header className="recovery-item-heading">
                <div><strong>저장된 녹음</strong><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></div>
                <StatusBadge label={recoveryLabel(item.kind)} tone={item.kind === 'recoverable' ? 'success' : 'warning'} />
              </header>
              <dl className="recovery-metrics">
                <div><dt>녹음 길이</dt><dd>{formatDuration(item.durationMs)}</dd></div>
                <div><dt>저장 크기</dt><dd>{formatBytes(item.byteCount)}</dd></div>
              </dl>
              {item.kind === 'exportOnly' && <InlineNotice tone="warning" title="복구 정보 손상"><p>매니페스트를 읽을 수 없어 원본 바이트는 내보내기 전용으로 보존됩니다.</p></InlineNotice>}
              <ActionBar danger={<Button variant="danger" disabled={busy || confirming !== null} onClick={() => setConfirming(item.meetingId)}>폐기</Button>}>
                {item.kind === 'exportOnly' ? (
                  <Button variant="primary" disabled={busy || confirming !== null} onClick={() => void exportBytes(item.meetingId)}>보존 바이트 내보내기</Button>
                ) : (
                  <>
                    {item.kind === 'recoverable' && <Button variant="primary" disabled={recoverDisabled || busy || confirming !== null} onClick={() => void decide(item.meetingId, 'recover')}>복구</Button>}
                    <Button variant="secondary" disabled={busy || confirming !== null} onClick={() => void decide(item.meetingId, 'keep')}>현재 파일로 보관</Button>
                  </>
                )}
              </ActionBar>
            </section>
          ))}
        </div>
        {error !== null && <InlineNotice tone="error" title="복구 결정 실패"><p>{error}</p></InlineNotice>}
        {confirming !== null && (
          <div className="dialog-scrim dialog-scrim-nested">
            <div className="dialog-panel dialog-panel-compact" role="alertdialog" aria-modal="true" aria-label="복구 녹음 영구 폐기">
              <header className="dialog-heading"><h2>영구 폐기할까요?</h2><p>보존된 녹음 바이트를 영구적으로 폐기합니다.</p></header>
              <ActionBar danger={<Button variant="danger" disabled={busy} onClick={() => void decide(confirming, 'discard')}>영구 폐기 확인</Button>}>
                <Button variant="secondary" disabled={busy} onClick={() => setConfirming(null)}>취소</Button>
              </ActionBar>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
