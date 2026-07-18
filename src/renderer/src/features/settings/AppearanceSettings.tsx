import type { ThemePreference } from '../../hooks/useThemePreference'
import { Icon } from '../../components/ui/Icon'

interface AppearanceSettingsProps {
  preference: ThemePreference
  onChange(value: ThemePreference): void
}

const themeOptions = [
  ['system', '자동'],
  ['light', '라이트'],
  ['dark', '다크'],
] as const

export function AppearanceSettings({
  preference,
  onChange,
}: AppearanceSettingsProps) {
  return (
    <section
      className="settings-section appearance-settings"
      aria-labelledby="appearance-title"
    >
      <div>
        <p className="eyebrow">APPEARANCE</p>
        <h2 id="appearance-title"><Icon name="appearance" />화면 테마</h2>
      </div>
      <div className="theme-picker">
        <div className="theme-picker-copy">
          <strong>화면 모드</strong>
          <p>자동 모드는 기기의 화면 설정을 따릅니다.</p>
        </div>
        <fieldset className="theme-options">
          <legend className="visually-hidden">화면 모드 선택</legend>
          {themeOptions.map(([value, label]) => (
            <label key={value} className="theme-option">
              <input
                type="radio"
                name="theme"
                value={value}
                checked={preference === value}
                onChange={() => onChange(value)}
              />
              <span className="theme-preview" data-preview={value} aria-hidden="true">
                <span className="theme-preview-sidebar" />
                <span className="theme-preview-content"><i /><i /><i /></span>
              </span>
              <span className="theme-option-label">{label}</span>
            </label>
          ))}
        </fieldset>
      </div>
    </section>
  )
}
