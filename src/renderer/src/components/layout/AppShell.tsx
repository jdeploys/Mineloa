import type { ReactNode } from 'react'
import { Icon, type IconName } from '../ui/Icon'
import { BrandMark } from '../ui/BrandMark'
import { Button } from '../ui/Button'

type PrimaryScreen = 'all' | 'templates' | 'settings'
export type QuickRecordStatus = 'idle' | 'recording' | 'saving' | 'unavailable'

export function AppShell({
  active,
  onNavigate,
  onQuickRecord,
  quickRecordStatus = 'idle',
  children,
}: {
  active: PrimaryScreen
  onNavigate(destination: PrimaryScreen): void
  onQuickRecord?(): void
  quickRecordStatus?: QuickRecordStatus
  children: ReactNode
}) {
  const entries: ReadonlyArray<readonly [PrimaryScreen, string, IconName]> = [
    ['all', '전체 기록', 'library'],
    ['templates', '요약 템플릿', 'template'],
    ['settings', '설정', 'settings'],
  ] as const

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          type="button"
          onClick={() => onNavigate('all')}
          aria-label="Mineloa 홈"
        >
          <BrandMark />
          <span>Mineloa</span>
        </button>
        <div className="topbar-actions">
          {onQuickRecord === undefined ? null : <Button
            className="topbar-quick-record"
            type="button"
            icon={quickRecordStatus === 'idle' ? 'microphone' : 'stop'}
            variant="primary"
            aria-label={quickRecordStatus === 'idle' ? '빠른 녹음 시작' : quickRecordStatus === 'recording' ? '녹음 종료' : quickRecordStatus === 'saving' ? '녹음 저장 중' : '녹음 상태 확인 필요'}
            disabled={quickRecordStatus === 'saving' || quickRecordStatus === 'unavailable'}
            onClick={onQuickRecord}
          ><span>{quickRecordStatus === 'idle' ? '녹음 시작' : quickRecordStatus === 'recording' ? '종료' : quickRecordStatus === 'saving' ? '저장 중' : '확인 필요'}</span></Button>}
          <nav className="app-nav" aria-label="주요 메뉴">
            {entries.map(([value, label, icon]) => (
              <button
                key={value}
                type="button"
                aria-current={active === value ? 'page' : undefined}
                data-focus-key={value === 'all' ? undefined : `nav-${value}`}
                onClick={() => onNavigate(value)}
              >
                <Icon name={icon} />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      {children}
    </div>
  )
}
