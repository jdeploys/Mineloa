import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { MeetingRepository } from '../../src/main/db/meetingRepository'
import { TemplateRepository } from '../../src/main/db/templateRepository'
import { exportMeetingArchive } from '../../src/main/archive/exportMeeting'
import { importMeetingArchive } from '../../src/main/archive/importMeeting'
import { parseArchive } from '../../src/main/archive/archiveSchema'

describe('Nnote archive round trip', () => {
  const roots: string[] = []
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

  it('remaps IDs while preserving semantic content and a relative retained WebM', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nnote-archive-')); roots.push(root)
    const sourceRecordings = join(root, 'source-recordings'); const targetRecordings = join(root, 'target-recordings')
    await mkdir(sourceRecordings); await mkdir(targetRecordings)
    const sourceDb = openDatabase(join(root, 'source.sqlite')); const targetDb = openDatabase(join(root, 'target.sqlite'))
    const sectionId = '10000000-0000-4000-8000-000000000009'
    const now = '2026-07-15T00:00:00.000Z'
    const template = { id: 'custom-template', name: '고객 회의', isDefault: false, sections: [{ id: sectionId, title: '핵심 요약', kind: 'paragraph' as const, prompt: '요약' }], createdAt: now, updatedAt: now }
    new TemplateRepository(sourceDb).save(template)
    const audioName = 'meeting.part-0.webm'; const audio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3])
    await writeFile(join(sourceRecordings, audioName), audio)
    sourceDb.prepare(`INSERT INTO meetings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('original', '고객 회의', now, now, 5000, 'completed', 'keep', audioName, audio.byteLength, template.id)
    sourceDb.prepare('INSERT INTO speakers VALUES (?, ?, ?)').run('0:B', 'original', '홍길동')
    sourceDb.prepare('INSERT INTO transcript_segments VALUES (?, ?, ?, ?, ?, ?)').run('seg-old', 'original', '0:B', 0, 5000, '진행합니다')
    sourceDb.prepare('INSERT INTO summary_sections VALUES (?, ?, ?, ?, ?, ?)').run('sum-old', 'original', sectionId, 'paragraph', JSON.stringify({ text: '요약', items: [] }), 0)
    sourceDb.prepare('INSERT INTO action_items VALUES (?, ?, ?, ?, ?, ?)').run('act-old', 'original', '배포', '0:B', null, 0)

    const exported = await exportMeetingArchive('original', new MeetingRepository(sourceDb), new TemplateRepository(sourceDb), sourceRecordings)
    const parsed = parseArchive(exported.bytes)
    expect(JSON.stringify(parsed)).not.toContain(sourceRecordings)
    expect(JSON.stringify(parsed)).not.toMatch(/sk-|processing_attempt/i)
    const imported = await importMeetingArchive(exported.bytes, targetDb, targetRecordings)
    expect(imported.meetingId).not.toBe('original')
    const target = new MeetingRepository(targetDb)
    expect(target.requireById(imported.meetingId)).toMatchObject({ title: '고객 회의', audioPath: expect.not.stringContaining('\\'), selectedTemplateId: expect.any(String) })
    expect(target.listSpeakers(imported.meetingId).map((s) => s.displayName)).toEqual(['홍길동'])
    expect(target.listTranscript(imported.meetingId).map((s) => [s.startMs, s.endMs, s.text])).toEqual([[0, 5000, '진행합니다']])
    expect(target.listActionItems(imported.meetingId).map((item) => item.content)).toEqual(['배포'])
    expect(await readFile(join(targetRecordings, target.requireById(imported.meetingId).audioPath!))).toEqual(Buffer.from(audio))
    sourceDb.close(); targetDb.close()
  })

  it('performs no writes when validation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nnote-archive-bad-')); roots.push(root)
    const recordings = join(root, 'recordings'); const database = openDatabase(join(root, 'target.sqlite'))
    await expect(importMeetingArchive(new Uint8Array([1, 2, 3]), database, recordings)).rejects.toThrow()
    expect(database.prepare('SELECT count(*) count FROM meetings').get()).toEqual({ count: 0 })
    database.close()
  })

  it('rolls back database rows and removes staged audio when the database commit fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nnote-archive-rollback-')); roots.push(root)
    const sourceRecordings = join(root, 'source'); const targetRecordings = join(root, 'target')
    await mkdir(sourceRecordings); await mkdir(targetRecordings)
    const sourceDb = openDatabase(join(root, 'source.sqlite')); const targetDb = openDatabase(join(root, 'target.sqlite'))
    const now = '2026-07-15T00:00:00.000Z'; const audioName = 'safe.webm'
    await writeFile(join(sourceRecordings, audioName), new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))
    sourceDb.prepare('INSERT INTO meetings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('source', '회의', now, now, 1, 'completed', 'keep', audioName, 4, null)
    const exported = await exportMeetingArchive('source', new MeetingRepository(sourceDb), new TemplateRepository(sourceDb), sourceRecordings)
    targetDb.exec("CREATE TRIGGER reject_import BEFORE INSERT ON meetings BEGIN SELECT RAISE(ABORT, 'forced'); END")
    await expect(importMeetingArchive(exported.bytes, targetDb, targetRecordings)).rejects.toThrow(/forced/)
    expect(targetDb.prepare('SELECT count(*) count FROM meetings').get()).toEqual({ count: 0 })
    expect((await import('node:fs/promises')).readdir(targetRecordings)).resolves.toEqual([])
    sourceDb.close(); targetDb.close()
  })
})
