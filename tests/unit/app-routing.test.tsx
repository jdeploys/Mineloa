// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '../../src/shared/contracts/desktopApi'
import type { MeetingDocument, PublicMeeting } from '../../src/shared/contracts/meetingsApi'
import { App } from '../../src/renderer/src/App'

const now = '2026-07-15T00:00:00.000Z'
const meeting: PublicMeeting = { id: 'meeting-1', title: '제품 회의', createdAt: now, updatedAt: now, durationMs: 1_000, status: 'completed', audioPolicy: 'keep', hasAudio: false, audioByteCount: 0, selectedTemplateId: null }
const documentFixture: MeetingDocument = { meeting, audioUrl: null, speakers: [], transcript: [], summarySections: [], actionItems: [] }

function api(overrides: Partial<DesktopApi['meetings']> = {}): DesktopApi {
  return {
    recovery: { scan: vi.fn(async () => []), recover: vi.fn(), keepAsFile: vi.fn(), discard: vi.fn() },
    meetings: {
      list: vi.fn(async () => [meeting]), get: vi.fn(async () => documentFixture),
      createRecording: vi.fn(async () => ({ ...meeting, id: 'recording-1', title: '새 회의', status: 'recording' })),
      renameSpeaker: vi.fn(),
      cancelEmptyRecording: vi.fn(async () => undefined),
      ...overrides,
    } as DesktopApi['meetings'],
    settings: { getApiKeyStatus: vi.fn(async () => ({ configured: false, lastValidatedAt: null })), saveApiKey: vi.fn(), deleteApiKey: vi.fn() },
    templates: { list: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), reorderSections: vi.fn(), delete: vi.fn() },
    recording: {} as DesktopApi['recording'],
    processing: { getStatus: vi.fn(), process: vi.fn(), retry: vi.fn(), onProgress: vi.fn(() => () => {}) },
  } as unknown as DesktopApi
}

describe('App route and recording ownership', () => {
  afterEach(cleanup)

  it('preserves active recording controls and identity across settings navigation without discard or a second start', async () => {
    const user = userEvent.setup()
    const desktopApi = api()
    const controller = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined), discard: vi.fn(async () => undefined) }
    render(<App desktopApi={desktopApi} recordingController={controller} />)
    await screen.findByRole('button', { name: '녹음 시작' })
    await user.click(screen.getByRole('button', { name: '녹음 시작' }))
    await user.click(screen.getByRole('button', { name: '설정' }))
    await user.click(screen.getByRole('button', { name: '← 전체 기록' }))

    await user.click(screen.getByRole('button', { name: '요약 템플릿' }))
    await user.click(screen.getByRole('button', { name: '← 전체 기록' }))
    await user.click(screen.getByRole('button', { name: /제품 회의/ }))
    await user.click(await screen.findByRole('button', { name: '← 전체 기록' }))

    expect(screen.getByText('녹음 중')).toBeVisible()
    expect(screen.queryByRole('button', { name: '녹음 시작' })).not.toBeInTheDocument()
    expect(controller.start).toHaveBeenCalledTimes(1)
    expect(controller.start).toHaveBeenCalledWith('recording-1')
    expect(controller.discard).not.toHaveBeenCalled()
  })

  it('removes an empty meeting created for a failed capture start and keeps the failure visible', async () => {
    const user = userEvent.setup()
    const desktopApi = api()
    const controller = { start: vi.fn(async () => { throw new Error('마이크 거부') }), stop: vi.fn(), discard: vi.fn() }
    render(<App desktopApi={desktopApi} recordingController={controller} />)
    await user.click(await screen.findByRole('button', { name: '녹음 시작' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('마이크 거부')
    expect(desktopApi.meetings.cancelEmptyRecording).toHaveBeenCalledWith('recording-1', { explicitDelete: true })
    expect(controller.discard).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '설정' }))
    await user.click(screen.getByRole('button', { name: '← 전체 기록' }))
    expect(screen.getByRole('alert')).toHaveTextContent('마이크 거부')
  })

  it('focuses route headings and restores the originating meeting row on back', async () => {
    const user = userEvent.setup()
    render(<App desktopApi={api()} recordingController={{ start: vi.fn(), stop: vi.fn(), discard: vi.fn() }} />)
    const row = await screen.findByRole('button', { name: /제품 회의/ })
    await user.click(row)
    expect(await screen.findByRole('heading', { name: '제품 회의' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: '← 전체 기록' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /제품 회의/ })).toHaveFocus())
  })

  it('focuses settings and template route headings', async () => {
    const user = userEvent.setup()
    render(<App desktopApi={api()} recordingController={{ start: vi.fn(), stop: vi.fn(), discard: vi.fn() }} />)
    await user.click(await screen.findByRole('button', { name: '설정' }))
    expect(screen.getByRole('heading', { name: '설정' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: '← 전체 기록' }))
    await user.click(screen.getByRole('button', { name: '요약 템플릿' }))
    expect(screen.getByRole('heading', { name: '요약 템플릿' })).toHaveFocus()
  })
})
