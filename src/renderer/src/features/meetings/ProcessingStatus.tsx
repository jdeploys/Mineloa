import { useEffect, useRef, useState } from 'react'
import type { ProcessingApi, ProcessingStatus as Status } from '../../../../shared/contracts/processing'
import { InlineNotice } from '../../components/feedback/InlineNotice'
import { Button } from '../../components/ui/Button'

export function ProcessingStatus({ meetingId, processing, initialStatus, onStatusChange }: { meetingId: string; processing: ProcessingApi; initialStatus: Status; onStatusChange?(status: Status): void }) {
  const [status, setStatus] = useState(initialStatus)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentMeeting = useRef(meetingId)
  const requestGeneration = useRef(0)
  currentMeeting.current = meetingId

  useEffect(() => processing.onProgress((next) => { if (next.meetingId === meetingId) { setStatus(next); onStatusChange?.(next) } }), [meetingId, onStatusChange, processing])
  useEffect(() => {
    requestGeneration.current += 1
    setStatus(initialStatus)
    setPending(false)
    setError(null)
  }, [meetingId, initialStatus])

  const active = pending || status.state === 'transcribing' || status.state === 'summarizing'
  const label = status.state === 'transcribing' ? '전사 중'
    : status.state === 'summarizing' ? '요약 중'
      : status.failedStage === 'transcribing' ? '전사 실패'
        : status.failedStage === 'summarizing' ? '요약 실패'
          : status.failedStage === 'cleanup' ? '오디오 정리 실패'
            : status.state === 'completed' ? '처리 완료' : '처리 대기'
  const action = status.failedStage === 'transcribing' ? '전사 다시 시도'
    : status.failedStage === 'summarizing' ? '요약 다시 시도'
      : status.failedStage === 'cleanup' ? '오디오 정리 다시 시도' : '전사 및 요약 시작'
  const tone = status.state === 'completed' ? 'success'
    : active ? 'info'
      : status.failedStage !== null ? (status.retryable ? 'warning' : 'error') : 'info'

  async function submit() {
    if (active) return
    const requestedMeeting = meetingId
    const generation = ++requestGeneration.current
    setPending(true)
    setError(null)
    try {
      const next = status.failedStage === null ? await processing.process(meetingId) : await processing.retry(meetingId)
      if (currentMeeting.current === requestedMeeting && requestGeneration.current === generation) {
        setStatus(next)
        onStatusChange?.(next)
      }
    } catch (cause) {
      if (currentMeeting.current === requestedMeeting && requestGeneration.current === generation) {
        setError(cause instanceof Error ? cause.message : '처리 요청에 실패했습니다.')
      }
    } finally {
      if (currentMeeting.current === requestedMeeting && requestGeneration.current === generation) {
        setPending(false)
      }
    }
  }

  return <InlineNotice tone={tone} title="AI 처리 상태">
    <div className="processing-panel">
      <div className="processing-copy">
        <strong>{label}</strong>
        <span>{status.audioRequired ? '원본 오디오 필요' : '원본 오디오 불필요'}</span>
        {status.error && <span>{status.error.message}</span>}
      </div>
      {status.state !== 'completed' && <Button variant="primary" disabled={active || (status.failedStage !== null && !status.retryable)} onClick={() => void submit()}>
        {active ? '처리 중' : action}
      </Button>}
    </div>
    {error && <p className="processing-error" role="alert">{error}</p>}
  </InlineNotice>
}
