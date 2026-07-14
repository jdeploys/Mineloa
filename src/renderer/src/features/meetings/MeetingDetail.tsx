import { useState } from 'react'
import type { Speaker } from '../../../../shared/contracts/meeting'
import type { MeetingDocument } from '../../../../shared/contracts/meetingsApi'
import type { StoredSummarySection } from '../../../../shared/contracts/summary'
import { SpeakerEditor } from './SpeakerEditor'
import { Transcript } from './Transcript'

const sectionTitles = ['핵심 요약', '결정사항', '할 일', '주요 논의'] as const

function formatDuration(durationMs: number): string {
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.floor((durationMs % 60_000) / 1_000)
  return `${minutes}분 ${seconds}초`
}

function replaceSpeakerIds(value: string, speakers: readonly Speaker[]): string {
  return speakers.reduce((text, speaker) => text.split(speaker.id).join(speaker.displayName), value)
}

function sectionBody(section: StoredSummarySection | undefined, speakers: readonly Speaker[]) {
  if (!section) return <p className="muted">내용이 없습니다.</p>
  if (section.kind === 'paragraph') return <p>{replaceSpeakerIds(section.text, speakers)}</p>
  return section.items.length === 0 ? <p className="muted">내용이 없습니다.</p> : <ul>{section.items.map((item, index) => <li key={index}>{replaceSpeakerIds(item, speakers)}</li>)}</ul>
}

function markdown(document: MeetingDocument, speakers: readonly Speaker[]): string {
  const names = new Map(speakers.map((speaker) => [speaker.id, speaker.displayName]))
  const lines = [`# ${document.meeting.title}`, '']
  for (const [index, title] of sectionTitles.entries()) {
    lines.push(`## ${title}`)
    if (title === '할 일') {
      for (const item of document.actionItems) lines.push(`- ${item.content} (담당: ${item.assigneeSpeakerId === null ? '미정' : names.get(item.assigneeSpeakerId) ?? item.assigneeSpeakerId})`)
    } else {
      const section = document.summarySections[index > 2 ? 2 : index]
      if (section?.text) lines.push(replaceSpeakerIds(section.text, speakers))
      for (const item of section?.items ?? []) lines.push(`- ${replaceSpeakerIds(item, speakers)}`)
    }
    lines.push('')
  }
  lines.push('## 전체 전사문')
  for (const segment of document.transcript) lines.push(`- ${segment.speakerId === null ? '화자 미상' : names.get(segment.speakerId) ?? segment.speakerId}: ${segment.text}`)
  return lines.join('\n')
}

export function MeetingDetail({ document, onBack, onRenameSpeaker }: {
  document: MeetingDocument
  onBack(): void
  onRenameSpeaker(meetingId: string, speakerId: string, displayName: string): Promise<Speaker>
}) {
  const [speakers, setSpeakers] = useState(document.speakers)
  async function rename(speakerId: string, displayName: string) {
    const updated = await onRenameSpeaker(document.meeting.id, speakerId, displayName)
    setSpeakers((current) => current.map((speaker) => speaker.id === updated.id ? updated : speaker))
  }
  const summary = document.summarySections.slice().sort((a, b) => a.orderIndex - b.orderIndex)
  const summaryWithoutActions = summary.filter((section) => section.kind !== 'action_items')
  const names = new Map(speakers.map((speaker) => [speaker.id, speaker.displayName]))

  return <main className="document-shell">
    <button type="button" className="back-button" onClick={onBack}>← 전체 기록</button>
    <article className="meeting-document">
      <header className="document-header">
        <span className={`status status-${document.meeting.status}`}>{document.meeting.status}</span>
        <h1>{document.meeting.title}</h1>
        <p className="document-meta">{new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long' }).format(new Date(document.meeting.createdAt))} · {formatDuration(document.meeting.durationMs)}</p>
        {document.audioUrl === null ? <p className="muted">보존된 원본 오디오가 없습니다.</p> : <audio aria-label="회의 오디오" controls preload="metadata" src={document.audioUrl} />}
      </header>
      <section><h2>핵심 요약</h2>{sectionBody(summaryWithoutActions[0], speakers)}</section>
      <section><h2>결정사항</h2>{sectionBody(summaryWithoutActions[1], speakers)}</section>
      <section><h2>할 일</h2>{document.actionItems.length === 0 ? <p className="muted">등록된 할 일이 없습니다.</p> : <ul className="action-list">{document.actionItems.map((item) => <li key={item.id}><span>{item.content}</span><small>담당: {item.assigneeSpeakerId === null ? '미정' : names.get(item.assigneeSpeakerId) ?? item.assigneeSpeakerId}</small></li>)}</ul>}</section>
      <section><h2>주요 논의</h2>{sectionBody(summaryWithoutActions[2], speakers)}</section>
      <section><h2>화자 이름</h2><SpeakerEditor speakers={speakers} onRename={rename} /></section>
      <section><h2>전체 전사문</h2><Transcript segments={document.transcript} speakers={speakers} /></section>
      <section className="markdown-preview"><h2>Markdown 미리보기</h2><pre data-testid="markdown-preview">{markdown(document, speakers)}</pre></section>
    </article>
  </main>
}
