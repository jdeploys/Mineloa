// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProcessingStatus } from '../../src/renderer/src/features/meetings/ProcessingStatus'

describe('ProcessingStatus', () => {
  it('shows the exact stage and disables duplicate processing while active', () => {
    render(<ProcessingStatus meetingId="m1" processing={{ getStatus: vi.fn(), process: vi.fn(), retry: vi.fn(), onProgress: vi.fn(() => () => {}) }} initialStatus={{ meetingId: 'm1', state: 'transcribing', failedStage: null, retryable: false, audioRequired: true, error: null }} />)
    expect(screen.getByText('전사 중')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '처리 중' })).toBeDisabled()
    expect(screen.getByText('원본 오디오 필요')).toBeInTheDocument()
  })

  it('shows summary retry without an audio requirement and recovers after retry errors', async () => {
    const completed = { meetingId: 'm1', state: 'completed' as const, failedStage: null, retryable: false, audioRequired: false, error: null }
    const retry = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(completed)
    render(<ProcessingStatus meetingId="m1" processing={{ getStatus: vi.fn(), process: vi.fn(), retry, onProgress: vi.fn(() => () => {}) }} initialStatus={{ meetingId: 'm1', state: 'failed', failedStage: 'summarizing', retryable: true, audioRequired: false, error: { code: 'OPENAI_NETWORK', message: '네트워크 오류' } }} />)
    expect(screen.getByText('요약 실패')).toBeInTheDocument()
    expect(screen.getByText('원본 오디오 불필요')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '요약 다시 시도' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
    fireEvent.click(screen.getByRole('button', { name: '요약 다시 시도' }))
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(2))
  })
})
