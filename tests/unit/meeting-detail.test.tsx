// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MeetingDocument } from '../../src/shared/contracts/meetingsApi'
import { MeetingDetail } from '../../src/renderer/src/features/meetings/MeetingDetail'

const documentFixture = (): MeetingDocument => ({
  meeting: {
    id: 'meeting-1', title: '제품 회의', status: 'completed',
    createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:01:00.000Z',
    durationMs: 65_000, audioPolicy: 'keep', hasAudio: true,
    audioByteCount: 10, selectedTemplateId: 'default',
  },
  audioUrl: 'nnote-media://meeting/bWVldGluZy0x',
  speakers: [{ id: '0:B', meetingId: 'meeting-1', displayName: '화자 B' }],
  transcript: [{ id: 's1', meetingId: 'meeting-1', speakerId: '0:B', startMs: 1_000, endMs: 2_500, text: '원본 발언입니다.' }],
  summarySections: [
    { id: 'a', title: '핵심 요약', meetingId: 'meeting-1', templateSectionId: '10000000-0000-4000-8000-000000000001', kind: 'paragraph', text: '0:B가 제안을 설명했습니다.', items: [], orderIndex: 0 },
    { id: 'b', title: '결정사항', meetingId: 'meeting-1', templateSectionId: '10000000-0000-4000-8000-000000000002', kind: 'bullet_list', text: '', items: ['제안을 채택합니다.'], orderIndex: 1 },
    { id: 'action-section', title: '할 일', meetingId: 'meeting-1', templateSectionId: '10000000-0000-4000-8000-000000000003', kind: 'action_items', text: '', items: ['이 문구는 주요 논의가 아닙니다.'], orderIndex: 2 },
    { id: 'c', title: '주요 논의', meetingId: 'meeting-1', templateSectionId: '10000000-0000-4000-8000-000000000004', kind: 'bullet_list', text: '', items: ['근거를 검토했습니다.'], orderIndex: 3 },
  ],
  actionItems: [{ id: 'todo', meetingId: 'meeting-1', content: '초안 작성', assigneeSpeakerId: '0:B', dueAt: null, completed: false }],
})

describe('single-document meeting detail', () => {
  afterEach(cleanup)

  it('meeting-detail-shows-completed-document-in-approved-order', () => {
    render(<MeetingDetail document={documentFixture()} onBack={vi.fn()} onRenameSpeaker={vi.fn()} />)
    const headings = screen.getAllByRole('heading').map((node) => node.textContent)
    expect(headings).toEqual(['제품 회의', '핵심 요약', '결정사항', '할 일', '주요 논의', '화자 이름', '전체 전사문', 'Markdown 미리보기'])
    expect(screen.getByLabelText('회의 오디오')).toHaveAttribute('src', 'nnote-media://meeting/bWVldGluZy0x')
  })

  it('meeting-detail-shows-renamed-speaker-everywhere-without-changing-transcript', async () => {
    const user = userEvent.setup()
    const source = documentFixture()
    const original = structuredClone(source.transcript)
    const rename = vi.fn(async (_meetingId: string, _speakerId: string, displayName: string) => ({
      ...source.speakers[0], displayName,
    }))
    render(<MeetingDetail document={source} onBack={vi.fn()} onRenameSpeaker={rename} />)

    await user.clear(screen.getByLabelText('화자 B 이름'))
    await user.type(screen.getByLabelText('화자 B 이름'), '민지')
    await user.click(screen.getByRole('button', { name: '화자 B 이름 저장' }))

    expect(await screen.findAllByText(/민지/)).not.toHaveLength(0)
    expect(screen.getByText('민지가 제안을 설명했습니다.')).toBeVisible()
    expect(screen.getAllByText(/담당: 민지/)[0]).toBeVisible()
    expect(screen.getByTestId('markdown-preview')).toHaveTextContent('민지')
    expect(source.transcript).toEqual(original)
    expect(source.transcript[0]).toMatchObject({ text: '원본 발언입니다.', startMs: 1_000, endMs: 2_500 })
  })

  it('keeps transcript text and timestamps visible after a speaker rename', async () => {
    const source = documentFixture()
    render(<MeetingDetail document={source} onBack={vi.fn()} onRenameSpeaker={async (_m, _s, name) => ({ ...source.speakers[0], displayName: name })} />)
    const user = userEvent.setup()
    await user.clear(screen.getByLabelText('화자 B 이름'))
    await user.type(screen.getByLabelText('화자 B 이름'), '민지')
    await user.click(screen.getByRole('button', { name: '화자 B 이름 저장' }))
    expect(screen.getByText('00:01–00:02')).toBeVisible()
    expect(screen.getByText('원본 발언입니다.')).toBeVisible()
  })

  it('maps the real default action and discussion sections by stable identity in Markdown', () => {
    render(<MeetingDetail document={documentFixture()} onBack={vi.fn()} onRenameSpeaker={vi.fn()} />)
    const preview = screen.getByTestId('markdown-preview')
    expect(preview).toHaveTextContent('## 주요 논의')
    expect(preview).toHaveTextContent('근거를 검토했습니다.')
    expect(preview).not.toHaveTextContent('이 문구는 주요 논의가 아닙니다.')
  })
})
