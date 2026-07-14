import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { openDatabase } from '../../src/main/db/database'
import { MeetingRepository } from '../../src/main/db/meetingRepository'
import { createMediaResponse, meetingMediaUrl } from '../../src/main/media/registerMediaProtocol'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'nnote-media-'))
  roots.push(root)
  const recordings = join(root, 'recordings')
  await mkdir(recordings)
  const database = openDatabase(join(root, 'nnote.sqlite'))
  const meetings = new MeetingRepository(database)
  return { root, recordings, database, meetings }
}

async function retainedMeeting(audioPath = 'first.webm') {
  const h = await harness()
  await writeFile(join(h.recordings, audioPath), Uint8Array.from([0, 1, 2, 3, 4, 5]))
  const now = new Date().toISOString()
  h.meetings.create({ id: 'meeting-1', title: '회의', createdAt: now, updatedAt: now, durationMs: 1,
    status: 'completed', audioPolicy: 'keep', audioPath, audioByteCount: 6, selectedTemplateId: null })
  return h
}

function request(url: string, range?: string): Request {
  return { url, method: 'GET', headers: new Headers(range === undefined ? undefined : { range }) } as Request
}

describe('privileged local meeting audio protocol', () => {
  it('streams only the repository-selected primary retained part', async () => {
    const h = await retainedMeeting()
    await writeFile(join(h.recordings, 'second.webm'), Uint8Array.from([9, 9, 9]))
    const response = await createMediaResponse(request(meetingMediaUrl('meeting-1')), h.meetings, h.recordings)
    expect(response.status).toBe(200)
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1, 2, 3, 4, 5])
    expect(response.headers.get('content-length')).toBe('6')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    h.database.close()
  })

  it('serves valid byte ranges and rejects unsatisfiable ranges', async () => {
    const h = await retainedMeeting()
    const partial = await createMediaResponse(request(meetingMediaUrl('meeting-1'), 'bytes=2-4'), h.meetings, h.recordings)
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe('bytes 2-4/6')
    expect([...new Uint8Array(await partial.arrayBuffer())]).toEqual([2, 3, 4])
    const invalid = await createMediaResponse(request(meetingMediaUrl('meeting-1'), 'bytes=99-'), h.meetings, h.recordings)
    expect(invalid.status).toBe(416)
    expect(invalid.headers.get('content-range')).toBe('bytes */6')
    h.database.close()
  })

  it.each([
    'nnote-media://meeting/../settings',
    'nnote-media://meeting/%2e%2e',
    'nnote-media://meeting/%2Fetc',
    'nnote-media://meeting/C:%5Csecret',
    'nnote-media://user@meeting/meeting-1',
    'nnote-media://meeting/meeting-1?path=secret',
  ])('rejects malformed or path-like URL %s', async (url) => {
    const h = await retainedMeeting()
    const response = await createMediaResponse(request(url), h.meetings, h.recordings)
    expect(response.status).toBe(404)
    h.database.close()
  })

  it('returns 404 for deleted, missing, directory, and root-escaping audio', async () => {
    const h = await retainedMeeting()
    const now = new Date().toISOString()
    h.meetings.create({ id: 'deleted', title: '삭제', createdAt: now, updatedAt: now, durationMs: 1,
      status: 'deleted', audioPolicy: 'keep', audioPath: basename(join(h.recordings, 'first.webm')), audioByteCount: 6, selectedTemplateId: null })
    h.meetings.create({ id: 'missing', title: '없음', createdAt: now, updatedAt: now, durationMs: 1,
      status: 'completed', audioPolicy: 'keep', audioPath: 'missing.webm', audioByteCount: 6, selectedTemplateId: null })
    await mkdir(join(h.recordings, 'folder'))
    h.meetings.create({ id: 'directory', title: '폴더', createdAt: now, updatedAt: now, durationMs: 1,
      status: 'completed', audioPolicy: 'keep', audioPath: 'folder', audioByteCount: 6, selectedTemplateId: null })
    h.meetings.create({ id: 'escape', title: '탈출', createdAt: now, updatedAt: now, durationMs: 1,
      status: 'completed', audioPolicy: 'keep', audioPath: '..\\outside.webm', audioByteCount: 6, selectedTemplateId: null })
    for (const id of ['deleted', 'missing', 'directory', 'escape']) {
      expect((await createMediaResponse(request(meetingMediaUrl(id)), h.meetings, h.recordings)).status).toBe(404)
    }
    h.database.close()
  })

  it('rejects a repository path whose final file is a symbolic link', async () => {
    const h = await harness()
    const outside = join(h.root, 'outside.webm')
    await writeFile(outside, Uint8Array.from([1, 2, 3]))
    await symlink(outside, join(h.recordings, 'linked.webm'), 'file')
    const now = new Date().toISOString()
    h.meetings.create({ id: 'linked', title: '링크', createdAt: now, updatedAt: now, durationMs: 1,
      status: 'completed', audioPolicy: 'keep', audioPath: 'linked.webm', audioByteCount: 3, selectedTemplateId: null })
    expect((await createMediaResponse(request(meetingMediaUrl('linked')), h.meetings, h.recordings)).status).toBe(404)
    h.database.close()
  })
})
