import type { ThemePreference } from '../../hooks/useThemePreference'
import { Icon } from '../../components/ui/Icon'

interface AppearanceSettingsProps {
  preference: ThemePreference
  onChange(value: ThemePreference): void
}

const themeOptions = [
  ['system', '시스템 설정'],
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
      <fieldset className="theme-options">
        <legend>테마 선택</legend>
        {themeOptions.map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="theme"
              value={value}
              checked={preference === value}
              onChange={() => onChange(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <p className="field-help">
        시스템 설정은 Windows 또는 macOS의 화면 모드를 자동으로 따릅니다.
      </p>
    </section>
  )
}
