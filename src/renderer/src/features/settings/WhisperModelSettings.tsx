import { useEffect, useRef, useState } from 'react'
import type {
  ProcessingProviderDescriptor,
  SettingsApi,
  WhisperModelId,
  WhisperModelProgress,
  WhisperModelStatus,
} from '../../../../shared/contracts/settings'

const modelNames: Readonly<Record<WhisperModelId, string>> = { base: 'base', small: 'small' }

function formatBytes(value: number) {
  return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)} MB`
}

export function WhisperModelSettings({
  settings, modelId, descriptor, onAvailabilityChanged,
}: {
  settings: SettingsApi
  modelId: WhisperModelId
  descriptor: ProcessingProviderDescriptor
  onAvailabilityChanged: () => Promise<void>
}) {
  const [status, setStatus] = useState<WhisperModelStatus | null>(null)
  const [progress, setProgress] = useState<WhisperModelProgress | null>(null)
  const [busyModelId, setBusyModelId] = useState<WhisperModelId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    const current = ++generation.current
    setStatus(null)
    setProgress(null)
    setError(null)
    void settings.listWhisperModels().then((models) => {
      if (generation.current !== current) return
      setStatus(models.find((item) => item.modelId === modelId) ?? null)
    }).catch(() => {
      if (generation.current === current) setError('모델 상태를 불러오지 못했습니다. 잠시 후 다시 시도하세요.')
    })
    const unsubscribe = settings.onWhisperModelProgress((next) => {
      if (generation.current === current && next.modelId === modelId) setProgress(next)
    })
    return () => {
      generation.current += 1
      unsubscribe()
    }
  }, [modelId, settings])

  const runAction = async (action: (id: WhisperModelId) => Promise<WhisperModelStatus>) => {
    const current = generation.current
    const actionModelId = modelId
    setBusyModelId(actionModelId)
    setError(null)
    try {
      const next = await action(actionModelId)
      if (generation.current === current) {
        setStatus(next)
        setProgress(null)
        await onAvailabilityChanged()
      }
    } catch {
      if (generation.current === current) setError('모델 작업을 완료하지 못했습니다. 네트워크와 저장 공간을 확인한 뒤 다시 시도하세요.')
    } finally {
      if (mounted.current) setBusyModelId((active) => active === actionModelId ? null : active)
    }
  }

  const activeProgress = progress ?? (status?.state === 'downloading'
    ? { modelId, receivedBytes: status.receivedBytes, totalBytes: status.expectedBytes }
    : null)
  const installed = status?.state === 'installed'
  const busy = busyModelId === modelId
  const runtimeText = descriptor.availability.available
    ? '로컬 처리 구성 요소를 사용할 수 있습니다.'
    : '로컬 처리 구성 요소 또는 선택한 모델을 아직 사용할 수 없습니다.'

  return <section className="model-status" aria-label="로컬 Whisper 모델 상태">
    {descriptor.privacy === 'local' && <div className="provider-notice provider-notice-local">
      <strong>오디오는 외부로 전송되지 않습니다.</strong>
      <p>화자 분리를 지원하지 않습니다.</p>
    </div>}
    <div className="provider-status-row">
      <span className={`status-dot ${descriptor.availability.available ? 'is-ready' : 'is-warning'}`} aria-hidden="true" />
      <p>{runtimeText}</p>
    </div>
    <div className="model-card">
      <div>
        <strong>{modelNames[modelId]} 모델</strong>
        <p>{status === null ? '상태 확인 중' : installed ? `설치됨 · ${formatBytes(status.expectedBytes)}` : `설치 필요 · ${formatBytes(status.expectedBytes)}`}</p>
      </div>
      {installed
        ? <button className="button-danger" type="button" disabled={busy} onClick={() => void runAction(settings.deleteWhisperModel)}>{modelNames[modelId]} 모델 삭제</button>
        : <button className="button-primary" type="button" disabled={busy || status === null || status.state === 'downloading'} onClick={() => void runAction(settings.downloadWhisperModel)}>{status?.state === 'downloading' ? '다운로드 중' : `${modelNames[modelId]} 모델 다운로드`}</button>}
    </div>
    {activeProgress !== null && <div className="model-progress">
      <div><span>다운로드 중</span><span>{Math.round((activeProgress.receivedBytes / activeProgress.totalBytes) * 100)}%</span></div>
      <progress aria-label={`${modelNames[modelId]} 모델 다운로드 진행률`} value={activeProgress.receivedBytes} max={activeProgress.totalBytes} />
      <p>{formatBytes(activeProgress.receivedBytes)} / {formatBytes(activeProgress.totalBytes)}</p>
    </div>}
    {error !== null && <p role="alert" className="settings-alert">{error}</p>}
  </section>
}
