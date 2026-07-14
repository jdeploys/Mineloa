import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { TemplateRepository } from '../../src/main/db/templateRepository'
import {
  DEFAULT_TEMPLATE_ID,
  DEFAULT_TEMPLATE_SECTIONS,
} from '../../src/main/templates/defaultTemplate'
import {
  ImmutableDefaultTemplateError,
  TemplateService,
} from '../../src/main/templates/templateService'

const directories: string[] = []

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'nnote-template-'))
  directories.push(root)
  const database = openDatabase(join(root, 'nnote.sqlite'))
  const service = new TemplateService(new TemplateRepository(database))
  service.seedDefault()
  return { database, service }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('TemplateService', () => {
  it('seeds the immutable default idempotently with the exact ordered Korean sections', () => {
    const { database, service } = harness()
    service.seedDefault()

    const templates = service.list()
    expect(templates).toHaveLength(1)
    expect(templates[0]).toMatchObject({ id: DEFAULT_TEMPLATE_ID, name: '기본 템플릿', isDefault: true })
    expect(templates[0]?.sections).toEqual(DEFAULT_TEMPLATE_SECTIONS)
    expect(templates[0]?.sections.map(({ title }) => title)).toEqual([
      '핵심 요약', '결정사항', '할 일', '주요 논의',
    ])
    database.close()
  })

  it('reconciles a valid but altered default exactly while leaving user templates untouched', () => {
    const root = mkdtempSync(join(tmpdir(), 'nnote-template-altered-'))
    directories.push(root)
    const database = openDatabase(join(root, 'nnote.sqlite'))
    const repository = new TemplateRepository(database)
    const timestamp = '2026-07-14T00:00:00.000Z'
    repository.save({
      id: DEFAULT_TEMPLATE_ID,
      name: '변형된 기본 템플릿',
      isDefault: true,
      sections: [{ id: '10000000-0000-4000-8000-000000000099', title: '변형', kind: 'paragraph', prompt: '변형된 지시문' }],
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const user = repository.save({
      id: 'user-template',
      name: '사용자 템플릿',
      isDefault: false,
      sections: [{ id: '10000000-0000-4000-8000-000000000098', title: '사용자', kind: 'bullet_list', prompt: '그대로 유지' }],
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const service = new TemplateService(repository)

    const reconciled = service.seedDefault()

    expect(reconciled).toMatchObject({ id: DEFAULT_TEMPLATE_ID, name: '기본 템플릿', isDefault: true })
    expect(reconciled.sections).toEqual(DEFAULT_TEMPLATE_SECTIONS)
    expect(service.get(user.id)).toEqual(user)
    database.close()
  })

  it('does not rewrite an already exact default', () => {
    const { database, service } = harness()
    const before = JSON.stringify(service.get(DEFAULT_TEMPLATE_ID))

    service.seedDefault()

    expect(JSON.stringify(service.get(DEFAULT_TEMPLATE_ID))).toBe(before)
    database.close()
  })

  it('creates, renames, safely reorders, and deletes a user template while preserving stable UUID section ids', () => {
    const { database, service } = harness()
    const created = service.create({
      name: ' 주간 회의 ',
      sections: [
        { title: '요약', kind: 'paragraph', prompt: '짧게 요약해 주세요.' },
        { title: '후속 작업', kind: 'action_items', prompt: '담당자와 할 일을 정리해 주세요.' },
      ],
    })
    const sectionIds = created.sections.map(({ id }) => id)

    const renamed = service.update(created.id, { name: '제품 회의' })
    const reordered = service.reorderSections(created.id, [...sectionIds].reverse())

    expect(created.name).toBe('주간 회의')
    expect(sectionIds).toEqual(sectionIds.map((id) => expect.stringMatching(/^[0-9a-f-]{36}$/)))
    expect(renamed.name).toBe('제품 회의')
    expect(reordered.sections.map(({ id }) => id)).toEqual([...sectionIds].reverse())
    expect(reordered.sections.map(({ id }) => id).sort()).toEqual([...sectionIds].sort())
    service.delete(created.id)
    expect(service.list().map(({ id }) => id)).toEqual([DEFAULT_TEMPLATE_ID])
    database.close()
  })

  it('rejects invalid user templates and unsafe reorder requests', () => {
    const { database, service } = harness()
    expect(() => service.create({ name: ' ', sections: [{ title: 'x', kind: 'paragraph', prompt: 'ok' }] })).toThrow()
    expect(() => service.create({ name: 'x', sections: [] })).toThrow()
    expect(() => service.create({ name: 'x', sections: Array.from({ length: 9 }, (_, index) => ({ title: String(index), kind: 'paragraph' as const, prompt: 'ok' })) })).toThrow()
    expect(() => service.create({ name: 'x', sections: [{ title: 'x', kind: 'paragraph', prompt: 'x'.repeat(2001) }] })).toThrow()
    const created = service.create({ name: 'x', sections: [{ title: 'x', kind: 'bullet_list', prompt: 'ok' }] })
    expect(() => service.reorderSections(created.id, ['unknown-section-id'])).toThrow()
    expect(() => service.update(created.id, { sections: [{ ...created.sections[0]!, id: '10000000-0000-4000-8000-000000000099' }] })).toThrow(/stable/i)
    expect(service.get(created.id).sections).toEqual(created.sections)
    database.close()
  })

  it('refuses modify, reorder, and delete operations on the default and leaves it byte-for-byte unchanged', () => {
    const { database, service } = harness()
    const before = JSON.stringify(service.get(DEFAULT_TEMPLATE_ID))

    for (const operation of [
      () => service.update(DEFAULT_TEMPLATE_ID, { name: '바꿈' }),
      () => service.reorderSections(DEFAULT_TEMPLATE_ID, DEFAULT_TEMPLATE_SECTIONS.map(({ id }) => id).reverse()),
      () => service.delete(DEFAULT_TEMPLATE_ID),
    ]) {
      expect(operation).toThrow(ImmutableDefaultTemplateError)
      expect(JSON.stringify(service.get(DEFAULT_TEMPLATE_ID))).toBe(before)
    }
    database.close()
  })
})
