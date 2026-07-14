import { open, readdir, rename, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { completedPartPath, recordingFilePrefix } from '../recording/recordingPaths'

const JournalSchema = z.object({ version: z.literal(1), meetingId: z.string().uuid() }).strict()

export function importJournalPath(recordingsDirectory: string, meetingId: string): string {
  return join(recordingsDirectory, `${recordingFilePrefix(meetingId)}import.json`)
}
export function importStagedAudioPath(recordingsDirectory: string, meetingId: string): string {
  return `${completedPartPath(recordingsDirectory, meetingId, 0)}.importing`
}

export async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, 'r')
    try { await handle.sync() } finally { await handle.close() }
  } catch (error) {
    if (!['EPERM', 'EACCES', 'EISDIR', 'EBADF', 'EINVAL', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
  }
}

export async function writeImportJournal(recordingsDirectory: string, meetingId: string): Promise<void> {
  const path = importJournalPath(recordingsDirectory, meetingId)
  const handle = await open(path, 'wx')
  try { await handle.writeFile(JSON.stringify({ version: 1, meetingId }), 'utf8'); await handle.sync() }
  finally { await handle.close() }
  await syncDirectory(recordingsDirectory)
}

async function exists(path: string): Promise<boolean> {
  try { const handle = await open(path, 'r'); await handle.close(); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}

export async function reconcileImportJournals(database: Database.Database, recordingsDirectory: string): Promise<void> {
  let names: string[]
  try { names = await readdir(recordingsDirectory) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  for (const name of names.filter((value) => value.endsWith('.import.json')).sort()) {
    const journalPath = join(recordingsDirectory, name)
    let journal: z.infer<typeof JournalSchema>
    try {
      const handle = await open(journalPath, 'r')
      try { journal = JournalSchema.parse(JSON.parse(await handle.readFile('utf8'))) } finally { await handle.close() }
      if (basename(importJournalPath(recordingsDirectory, journal.meetingId)) !== name) throw new Error('Journal name mismatch')
    } catch (error) {
      throw new Error('Import recovery journal is corrupt; files were preserved.', { cause: error })
    }
    const staged = importStagedAudioPath(recordingsDirectory, journal.meetingId)
    const final = completedPartPath(recordingsDirectory, journal.meetingId, 0)
    const row = database.prepare('SELECT id, audio_path FROM meetings WHERE id = ?').get(journal.meetingId) as { id: string; audio_path: string | null } | undefined
    if (row === undefined) {
      await rm(staged, { force: true }); await rm(final, { force: true })
    } else if (row.audio_path !== basename(final)) {
      throw new Error('Import recovery journal does not match meeting audio; files were preserved.')
    } else if (await exists(final)) {
      await rm(staged, { force: true })
    } else if (await exists(staged)) {
      await rename(staged, final)
    } else {
      throw new Error('Imported meeting audio is missing; recovery journal was preserved.')
    }
    await syncDirectory(recordingsDirectory)
    await rm(journalPath, { force: true })
    await syncDirectory(recordingsDirectory)
  }
}
