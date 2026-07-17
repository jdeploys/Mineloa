import type { ReactNode } from 'react'
import { Icon, type IconName } from '../ui/Icon'

type PrimaryScreen = 'all' | 'templates' | 'settings'

export function AppShell({
  active,
  onNavigate,
  onImport,
  children,
}: {
  active: PrimaryScreen
  onNavigate(destination: PrimaryScreen): void
  onImport?(): void
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
          aria-label="Nnote 홈"
        >
          Nnote
        </button>
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
          {onImport === undefined ? null : (
            <button type="button" className="nav-import" onClick={onImport}>
              <Icon name="import" />
              .nnote 가져오기
            </button>
          )}
        </nav>
      </header>
      {children}
    </div>
  )
}
