import { useEffect, useState, type Ref } from 'react'
import type { ArchiveApi } from '../../../../shared/contracts/archive'
import type { ProcessingApi, ProcessingStatus as ProcessingStatusValue } from '../../../../shared/contracts/processing'
import type { Speaker } from '../../../../shared/contracts/meeting'
import type { DocumentSummarySection, MeetingDocument } from '../../../../shared/contracts/meetingsApi'
import { InlineNotice } from '../../components/feedback/InlineNotice'
import { ActionBar } from '../../components/layout/ActionBar'
import { PageHeader } from '../../components/layout/PageHeader'
import { Button } from '../../components/ui/Button'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { SurfaceCard } from '../../components/ui/SurfaceCard'
import type { IconName } from '../../components/ui/Icon'
import { SpeakerEditor } from './SpeakerEditor'
import { Transcript } from './Transcript'
import { ProcessingStatus } from './ProcessingStatus'

function formatDuration(durationMs: number): string {
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.floor((durationMs % 60_000) / 1_000)
  return `${minutes}분 ${seconds}초`
}

function replaceSpeakerIds(value: string, speakers: readonly Speaker[]): string {
  return speakers.reduce((text, speaker) => text.split(speaker.id).join(speaker.displayName), value)
}

function sectionBody(section: DocumentSummarySection | undefined, speakers: readonly Speaker[]) {
  if (!section) return <p className="muted">내용이 없습니다.</p>
  if (section.kind === 'paragraph') return <p>{replaceSpeakerIds(section.text, speakers)}</p>
  return section.items.length === 0 ? <p className="muted">내용이 없습니다.</p> : <ul>{section.items.map((item, index) => <li key={index}>{replaceSpeakerIds(item, speakers)}</li>)}</ul>
}

function markdown(document: MeetingDocument, speakers: readonly Speaker[]): string {
  const names = new Map(speakers.map((speaker) => [speaker.id, speaker.displayName]))
  const lines = [`# ${document.meeting.title}`, '']
  const ordered = document.summarySections.slice().sort((a, b) => a.orderIndex - b.orderIndex)
  for (const section of ordered) {
    lines.push(`## ${section.title}`)
    if (section.kind === 'action_items') {
      for (const item of document.actionItems) lines.push(`- ${item.content} (담당: ${item.assigneeSpeakerId === null ? '미정' : names.get(item.assigneeSpeakerId) ?? item.assigneeSpeakerId})`)
    } else {
      if (section.text) lines.push(replaceSpeakerIds(section.text, speakers))
      for (const item of section.items) lines.push(`- ${replaceSpeakerIds(item, speakers)}`)
    }
    lines.push('')
  }
  lines.push('## 전체 전사문')
  for (const segment of document.transcript) lines.push(`- ${segment.speakerId === null ? '화자 미상' : names.get(segment.speakerId) ?? segment.speakerId}: ${segment.text}`)
  return lines.join('\n')
}

function meetingStatusTone(status: MeetingDocument['meeting']['status']): 'success' | 'warning' | 'danger' | 'active' {
  if (status === 'completed' || status === 'recorded') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'recording') return 'active'
  return 'warning'
}

function meetingStatusIcon(status: MeetingDocument['meeting']['status']): IconName {
  if (status === 'completed' || status === 'recorded') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'recording') return 'recording'
  return 'warning'
}

export function MeetingDetail({ document, onBack, onRenameSpeaker, headingRef, processing, initialProcessingStatus, archive, onRefresh }: {
  document: MeetingDocument
  onBack(): void
  onRenameSpeaker(meetingId: string, speakerId: string, displayName: string): Promise<Speaker>
  headingRef?: Ref<HTMLHeadingElement>
  processing?: ProcessingApi
  initialProcessingStatus?: ProcessingStatusValue
  archive?: ArchiveApi
  onRefresh?(): void | Promise<void>
}) {
  const [localSpeakerNames, setLocalSpeakerNames] = useState<Record<string, string>>({})
  const speakers = document.speakers.map((speaker) => ({
    ...speaker,
    displayName: localSpeakerNames[speaker.id] ?? speaker.displayName,
  }))
  useEffect(() => {
    setLocalSpeakerNames((current) => Object.fromEntries(Object.entries(current).filter(([speakerId, displayName]) =>
      document.speakers.some((speaker) => speaker.id === speakerId && speaker.displayName !== displayName),
    )))
  }, [document.speakers])
  async function rename(speakerId: string, displayName: string) {
    const previous = localSpeakerNames[speakerId]
      ?? document.speakers.find((speaker) => speaker.id === speakerId)?.displayName
    setLocalSpeakerNames((current) => ({ ...current, [speakerId]: displayName }))
    try {
      const updated = await onRenameSpeaker(document.meeting.id, speakerId, displayName)
      setLocalSpeakerNames((current) => ({ ...current, [updated.id]: updated.displayName }))
    } catch (cause) {
      setLocalSpeakerNames((current) => {
        const next = { ...current }
        if (previous === undefined) delete next[speakerId]
        else next[speakerId] = previous
        return next
      })
      throw cause
    }
  }
  const names = new Map(speakers.map((speaker) => [speaker.id, speaker.displayName]))
  const [archiveMessage, setArchiveMessage] = useState<{ tone: 'success' | 'info' | 'error'; message: string } | null>(null)
  const orderedSections = document.summarySections.slice().sort((a, b) => a.orderIndex - b.orderIndex)
  const audioParts = document.audioParts ?? (document.audioUrl === null ? [] : [{
    partIndex: 0, url: document.audioUrl, byteCount: document.meeting.audioByteCount,
    durationMs: document.meeting.durationMs,
  }])

  async function exportDocument(kind: 'nnote' | 'markdown') {
    if (archive === undefined) return
    const result = kind === 'nnote'
      ? await archive.exportMeeting(document.meeting.id)
      : await archive.exportMarkdown(document.meeting.id)
    setArchiveMessage(result.status === 'success' ? { tone: 'success', message: '내보내기를 완료했습니다.' }
      : result.status === 'cancelled' ? { tone: 'info', message: '내보내기를 취소했습니다.' }
        : { tone: 'error', message: result.message })
  }

  const formattedMeta = `${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long' }).format(new Date(document.meeting.createdAt))} · ${formatDuration(document.meeting.durationMs)}`

  return <main className="page-container meeting-page">
    <PageHeader ref={headingRef} backLabel="전체 기록" onBack={onBack} title={document.meeting.title} description={formattedMeta} trailing={<StatusBadge label={document.meeting.status} tone={meetingStatusTone(document.meeting.status)} icon={meetingStatusIcon(document.meeting.status)} />} />
    <SurfaceCard className="meeting-overview" labelledBy="meeting-audio-title">
      <h2 id="meeting-audio-title">오디오 및 처리</h2>
      <div className="audio-parts">
        {audioParts.length === 0 ? <p className="muted">보존된 원본 오디오가 없습니다.</p> : audioParts.map((part) => <div className="audio-part" key={part.partIndex}><span>오디오 파트 {part.partIndex + 1}</span><audio aria-label={audioParts.length === 1 ? '회의 오디오' : `회의 오디오 파트 ${part.partIndex + 1}`} controls preload="metadata" src={part.url} /></div>)}
      </div>
      {processing === undefined || initialProcessingStatus === undefined ? null : <ProcessingStatus meetingId={document.meeting.id} processing={processing} initialStatus={initialProcessingStatus} onStatusChange={(status) => { if (status.state === 'completed' || status.state === 'failed' || status.state === 'cleanup_failed') void onRefresh?.() }} />}
      {archive === undefined ? null : <ActionBar><Button icon="export" onClick={() => void exportDocument('nnote')}>.nnote 내보내기</Button><Button icon="download" variant="tertiary" onClick={() => void exportDocument('markdown')}>Markdown 내보내기</Button></ActionBar>}
      {archiveMessage === null ? null : <InlineNotice tone={archiveMessage.tone} title="내보내기 결과"><p role="status">{archiveMessage.message}</p></InlineNotice>}
    </SurfaceCard>
    <article className="meeting-document" aria-label="회의 문서">
      {orderedSections.map((section) => <section className="document-section" key={section.id}><h2>{section.title}</h2>{section.kind === 'action_items' ? (document.actionItems.length === 0 ? <p className="muted">등록된 할 일이 없습니다.</p> : <ul className="action-list">{document.actionItems.map((item) => <li key={item.id}><span>{item.content}</span><small>담당: {item.assigneeSpeakerId === null ? '미정' : names.get(item.assigneeSpeakerId) ?? item.assigneeSpeakerId}</small></li>)}</ul>) : sectionBody(section, speakers)}</section>)}
      <section className="document-section"><h2>화자 이름</h2><SpeakerEditor speakers={speakers} onRename={rename} /></section>
      <section className="document-section"><h2>전체 전사문</h2><Transcript segments={document.transcript} speakers={speakers} /></section>
      <details className="document-section markdown-preview"><summary>Markdown 미리보기</summary><pre className="markdown-code" data-testid="markdown-preview">{markdown(document, speakers)}</pre></details>
    </article>
  </main>
}
