import { strFromU8, unzipSync } from 'fflate'
import { z } from 'zod'
import { AudioPolicySchema, MeetingStatusSchema } from '../../shared/contracts/meeting'
import { SummaryTemplateSectionSchema } from '../../shared/contracts/template'

export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
export const MAX_ARCHIVE_ENTRIES = 5
export const ARCHIVE_ENTRIES = ['manifest.json', 'meeting.json', 'transcript.json', 'summary.json', 'audio.webm'] as const
const required = ARCHIVE_ENTRIES.slice(0, 4)

export const ArchiveTemplateSchema = z.object({
  sourceId: z.string().min(1), name: z.string().min(1).max(200),
  sections: z.array(SummaryTemplateSectionSchema).min(1).max(8),
}).strict()
export const ArchiveMeetingSchema = z.object({
  title: z.string(), createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
  durationMs: z.number().int().nonnegative(), status: MeetingStatusSchema,
  audioPolicy: AudioPolicySchema, template: ArchiveTemplateSchema.nullable(),
}).strict()
export const ArchiveTranscriptSchema = z.object({
  speakers: z.array(z.object({ id: z.string().min(1), displayName: z.string().min(1) }).strict()),
  segments: z.array(z.object({ id: z.string().min(1), speakerId: z.string().min(1).nullable(), startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative(), text: z.string() }).strict().refine((v) => v.endMs >= v.startMs)),
}).strict()
export const ArchiveSummarySchema = z.object({
  sections: z.array(z.object({ id: z.string().min(1), templateSectionId: z.string().uuid(), kind: z.enum(['paragraph', 'bullet_list', 'action_items']), text: z.string(), items: z.array(z.string()), orderIndex: z.number().int().nonnegative() }).strict()),
  actionItems: z.array(z.object({ id: z.string().min(1), content: z.string().min(1), assigneeSpeakerId: z.string().min(1).nullable(), dueAt: z.string().nullable(), completed: z.boolean() }).strict()),
}).strict()
export const ArchiveManifestSchema = z.object({
  format: z.literal('nnote'), version: z.literal(1),
  entries: z.array(z.enum(ARCHIVE_ENTRIES)).min(3).max(4),
}).strict()

export type ParsedArchive = {
  manifest: z.infer<typeof ArchiveManifestSchema>
  meeting: z.infer<typeof ArchiveMeetingSchema>
  transcript: z.infer<typeof ArchiveTranscriptSchema>
  summary: z.infer<typeof ArchiveSummarySchema>
  audio: Uint8Array | null
}

type CentralEntry = { name: string; compressedSize: number; uncompressedSize: number; crc: number; externalAttributes: number; madeBy: number; flags: number }
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

function centralEntries(bytes: Uint8Array): CentralEntry[] {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error('Archive exceeds 100MB')
  const dv = view(bytes)
  const start = Math.max(0, bytes.byteLength - 65_557)
  let eocd = -1
  for (let offset = bytes.byteLength - 22; offset >= start; offset--) {
    if (dv.getUint32(offset, true) === 0x06054b50) { eocd = offset; break }
  }
  if (eocd < 0) throw new Error('Invalid ZIP archive')
  const count = dv.getUint16(eocd + 10, true)
  const centralSize = dv.getUint32(eocd + 12, true)
  let offset = dv.getUint32(eocd + 16, true)
  if (count > MAX_ARCHIVE_ENTRIES) throw new Error('Archive has too many entries')
  if (offset + centralSize > eocd) throw new Error('Invalid ZIP central directory')
  const result: CentralEntry[] = []
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.byteLength || dv.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid ZIP entry')
    const madeBy = dv.getUint16(offset + 4, true)
    const nameLength = dv.getUint16(offset + 28, true)
    const extraLength = dv.getUint16(offset + 30, true)
    const commentLength = dv.getUint16(offset + 32, true)
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    result.push({ name, compressedSize: dv.getUint32(offset + 20, true), uncompressedSize: dv.getUint32(offset + 24, true), crc: dv.getUint32(offset + 16, true), externalAttributes: dv.getUint32(offset + 38, true), madeBy, flags: dv.getUint16(offset + 8, true) })
    offset += 46 + nameLength + extraLength + commentLength
  }
  if (offset !== dv.getUint32(eocd + 16, true) + centralSize) throw new Error('Invalid ZIP central directory size')
  return result
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function parseJson<T>(name: string, bytes: Uint8Array, schema: z.ZodType<T>): T {
  try { return schema.parse(JSON.parse(strFromU8(bytes))) }
  catch (error) { throw new Error(`Invalid ${name} JSON`, { cause: error }) }
}

export function parseArchive(bytes: Uint8Array): ParsedArchive {
  const central = centralEntries(bytes)
  let total = 0
  const names = new Set<string>()
  for (const entry of central) {
    total += entry.uncompressedSize
    if (entry.compressedSize > MAX_ARCHIVE_BYTES || entry.uncompressedSize > MAX_ARCHIVE_BYTES || total > MAX_ARCHIVE_BYTES) throw new Error('Archive entry exceeds 100MB')
    if (!ARCHIVE_ENTRIES.includes(entry.name as typeof ARCHIVE_ENTRIES[number])) throw new Error(`Archive entry path is not allowed: ${entry.name}`)
    const normalized = entry.name.normalize('NFKC').toLocaleLowerCase('en-US')
    if (names.has(normalized)) throw new Error('Archive contains duplicate entry names')
    names.add(normalized)
    const host = entry.madeBy >>> 8
    const unixMode = entry.externalAttributes >>> 16
    if ((entry.flags & 1) !== 0) throw new Error('Encrypted archive entries are not allowed')
    if (host === 3 && (unixMode & 0xf000) === 0xa000) throw new Error('Archive symlink entries are not allowed')
  }
  for (const name of required) if (!names.has(name)) throw new Error(`Archive entry is missing: ${name}`)
  let files: Record<string, Uint8Array>
  try { files = unzipSync(bytes) } catch (error) { throw new Error('Archive decompression failed', { cause: error }) }
  for (const entry of central) {
    const data = files[entry.name]
    if (data === undefined || data.byteLength !== entry.uncompressedSize || crc32(data) !== entry.crc) throw new Error('Archive CRC or size validation failed')
  }
  let rawManifest: unknown
  try { rawManifest = JSON.parse(strFromU8(files['manifest.json'])) } catch (error) { throw new Error('Invalid manifest.json JSON', { cause: error }) }
  if (typeof rawManifest === 'object' && rawManifest !== null && 'version' in rawManifest && rawManifest.version !== 1) throw new Error('Unsupported archive version')
  const manifest = ArchiveManifestSchema.parse(rawManifest)
  const actualPayload = central.map((e) => e.name).filter((n) => n !== 'manifest.json').sort()
  if (JSON.stringify([...manifest.entries].sort()) !== JSON.stringify(actualPayload)) throw new Error('Archive manifest entries do not match ZIP entries')
  const audio = files['audio.webm'] ?? null
  if (audio !== null && (audio.byteLength < 4 || audio[0] !== 0x1a || audio[1] !== 0x45 || audio[2] !== 0xdf || audio[3] !== 0xa3)) throw new Error('Archive audio is not WebM')
  return {
    manifest,
    meeting: parseJson('meeting.json', files['meeting.json'], ArchiveMeetingSchema),
    transcript: parseJson('transcript.json', files['transcript.json'], ArchiveTranscriptSchema),
    summary: parseJson('summary.json', files['summary.json'], ArchiveSummarySchema),
    audio,
  }
}
