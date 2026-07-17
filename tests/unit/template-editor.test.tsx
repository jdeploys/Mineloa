// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TemplateEditor } from '../../src/renderer/src/features/templates/TemplateEditor'
import type { TemplatesApi } from '../../src/shared/contracts/template'

afterEach(cleanup)

const defaultTemplate = {
  id: 'default', name: '기본 템플릿', isDefault: true as const,
  createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z',
  sections: [{ id: '10000000-0000-4000-8000-000000000001', title: '핵심 요약', kind: 'paragraph' as const, prompt: '요약' }],
}

describe('TemplateEditor', () => {
  it('saves the editable template name and sections through one primary action', async () => {
    const user = userEvent.setup()
    const editableTemplate = { ...defaultTemplate, id: 'custom', name: '사용자', isDefault: false as const }
    const api = {
      list: vi.fn(async () => [editableTemplate]),
      create: vi.fn(),
      update: vi.fn(async (_id, input) => ({
        ...editableTemplate,
        name: input.name ?? editableTemplate.name,
        sections: input.sections ?? editableTemplate.sections,
      })),
      reorderSections: vi.fn(),
      delete: vi.fn(),
    } satisfies TemplatesApi
    render(<TemplateEditor templates={api} />)
    await screen.findByDisplayValue('사용자')
    await user.clear(screen.getByLabelText('템플릿 이름'))
    await user.type(screen.getByLabelText('템플릿 이름'), '새 이름')
    await user.clear(screen.getByLabelText('섹션 1 지시문'))
    await user.type(screen.getByLabelText('섹션 1 지시문'), '핵심 니즈를 요약하세요.')
    await user.click(screen.getByRole('button', { name: '템플릿 저장' }))
    expect(api.update).toHaveBeenCalledTimes(1)
    expect(api.update).toHaveBeenCalledWith(editableTemplate.id, {
      name: '새 이름',
      sections: [expect.objectContaining({ prompt: '핵심 니즈를 요약하세요.' })],
    })
  })

  it('keeps the default template read-only and free of save or delete actions', async () => {
    const api = { list: vi.fn().mockResolvedValue([defaultTemplate]), create: vi.fn(), update: vi.fn(), reorderSections: vi.fn(), delete: vi.fn() } satisfies TemplatesApi
    render(<TemplateEditor templates={api} />)
    expect(await screen.findByText('기본 템플릿은 수정하거나 삭제할 수 없습니다.')).toBeVisible()
    expect(screen.queryByRole('button', { name: '템플릿 저장' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '템플릿 삭제' })).not.toBeInTheDocument()
  })

  it('shows the editable template primary actions and field labels', async () => {
    const editableTemplate = { ...defaultTemplate, id: 'custom', name: '사용자', isDefault: false as const }
    const api = { list: vi.fn(async () => [editableTemplate]), create: vi.fn(), update: vi.fn(), reorderSections: vi.fn(), delete: vi.fn() } satisfies TemplatesApi
    render(<TemplateEditor templates={api} />)
    expect(await screen.findByRole('button', { name: editableTemplate.name })).toHaveAttribute('aria-current', 'true')
    await screen.findByLabelText('섹션 1 지시문')
    expect(screen.getByLabelText('템플릿 이름')).toBeVisible()
    expect(screen.getByLabelText('섹션 1 지시문')).toBeVisible()
    expect(screen.getByRole('button', { name: '섹션 추가' })).toBeVisible()
    expect(screen.getByRole('button', { name: '템플릿 저장' })).toBeVisible()
    expect(screen.getByRole('button', { name: '템플릿 삭제' })).toBeVisible()
  })

  it('reorders editable template sections without saving the rest of the form', async () => {
    const user = userEvent.setup()
    const custom = { ...defaultTemplate, id: 'custom', name: '사용자', isDefault: false as const, sections: [defaultTemplate.sections[0]!, { id: '10000000-0000-4000-8000-000000000002', title: '할 일', kind: 'action_items' as const, prompt: '할 일' }] }
    const api = { list: vi.fn().mockResolvedValue([custom]), create: vi.fn(), update: vi.fn(), reorderSections: vi.fn().mockResolvedValue(custom), delete: vi.fn() } satisfies TemplatesApi
    render(<TemplateEditor templates={api} />)
    await screen.findByLabelText('섹션 2 제목')
    await user.click(screen.getAllByRole('button', { name: '위로 이동' })[1]!)
    expect(api.reorderSections).toHaveBeenCalledWith('custom', [custom.sections[1]!.id, custom.sections[0]!.id])
    expect(api.update).not.toHaveBeenCalled()
  })

  it('adds edits and removes custom sections while preserving one-to-eight validation', async () => {
    const user = userEvent.setup()
    const custom = { ...defaultTemplate, id: 'custom', name: '사용자', isDefault: false as const }
    const api = {
      list: vi.fn().mockResolvedValue([custom]), create: vi.fn(),
      update: vi.fn(async (_id, input) => ({ ...custom, sections: input.sections ?? custom.sections })),
      reorderSections: vi.fn(), delete: vi.fn(),
    } satisfies TemplatesApi
    render(<TemplateEditor templates={api} />)
    await screen.findByLabelText('섹션 1 제목')
    await user.clear(screen.getByLabelText('섹션 1 제목'))
    await user.type(screen.getByLabelText('섹션 1 제목'), '결론')
    await user.selectOptions(screen.getByLabelText('섹션 1 종류'), 'bullet_list')
    await user.clear(screen.getByLabelText('섹션 1 지시문'))
    await user.type(screen.getByLabelText('섹션 1 지시문'), '결론을 목록으로 정리하세요.')
    await user.click(screen.getByRole('button', { name: '섹션 추가' }))
    expect(screen.getByLabelText('섹션 2 제목')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: '섹션 제거' })[1]!)
    await user.click(screen.getByRole('button', { name: '템플릿 저장' }))
    expect(api.update).toHaveBeenCalledWith('custom', {
      name: '사용자',
      sections: [expect.objectContaining({ title: '결론', kind: 'bullet_list', prompt: '결론을 목록으로 정리하세요.' })],
    })
    expect(screen.getByRole('button', { name: '섹션 제거' })).toBeDisabled()
  })

  it('prevents selecting a second action_items section', async () => {
    const custom = {
      ...defaultTemplate, id: 'custom', name: '사용자', isDefault: false as const,
      sections: [
        { ...defaultTemplate.sections[0]!, kind: 'action_items' as const },
        { id: '10000000-0000-4000-8000-000000000002', title: '요약', kind: 'paragraph' as const, prompt: '요약' },
      ],
    }
    const api = { list: vi.fn().mockResolvedValue([custom]), create: vi.fn(), update: vi.fn(), reorderSections: vi.fn(), delete: vi.fn() } satisfies TemplatesApi
    render(<TemplateEditor templates={api} />)
    const secondKind = await screen.findByLabelText('섹션 2 종류')
    expect(within(secondKind).getByRole('option', { name: '할 일' })).toBeDisabled()
    expect(within(screen.getByLabelText('섹션 1 종류')).getByRole('option', { name: '할 일' })).not.toBeDisabled()
  })

  it('keeps editable templates within the eight-section maximum', async () => {
    const user = userEvent.setup()
    const custom = { ...defaultTemplate, id: 'custom', name: '사용자', isDefault: false as const }
    const api = { list: vi.fn().mockResolvedValue([custom]), create: vi.fn(), update: vi.fn(), reorderSections: vi.fn(), delete: vi.fn() } satisfies TemplatesApi
    render(<TemplateEditor templates={api} />)
    const add = await screen.findByRole('button', { name: '섹션 추가' })
    for (let index = 1; index < 8; index += 1) await user.click(add)
    expect(screen.getAllByRole('button', { name: '섹션 제거' })).toHaveLength(8)
    expect(add).toBeDisabled()
  })

  it('keeps template deletion as a separate danger action', async () => {
    const user = userEvent.setup()
    const custom = { ...defaultTemplate, id: 'custom', name: '사용자', isDefault: false as const }
    const api = { list: vi.fn().mockResolvedValue([custom]), create: vi.fn(), update: vi.fn(), reorderSections: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) } satisfies TemplatesApi
    render(<TemplateEditor templates={api} />)
    await user.click(await screen.findByRole('button', { name: '템플릿 삭제' }))
    expect(api.delete).toHaveBeenCalledWith(custom.id)
    expect(api.update).not.toHaveBeenCalled()
  })

  it('shows a safe in-use message when a referenced template edit is refused', async () => {
    const user = userEvent.setup()
    const custom = { ...defaultTemplate, id: 'custom', name: '사용자', isDefault: false as const }
    const inUse = Object.assign(new Error('Template custom is in use by a meeting'), { name: 'TemplateInUseError', code: 'TEMPLATE_IN_USE' })
    const api = {
      list: vi.fn().mockResolvedValue([custom]), create: vi.fn(),
      update: vi.fn().mockRejectedValue(inUse), reorderSections: vi.fn(), delete: vi.fn(),
    } satisfies TemplatesApi
    render(<TemplateEditor templates={api} />)
    await screen.findByLabelText('섹션 1 제목')
    await user.click(screen.getByRole('button', { name: '템플릿 저장' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('회의에서 사용 중인 템플릿은 변경할 수 없습니다.')
  })
})
