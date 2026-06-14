import { setTheme, useThemePreference, type Theme } from './theme'

const OPTIONS: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function AppearanceSettings() {
  const theme = useThemePreference()

  const pick = (value: Theme) => setTheme(value)

  return (
    <>
      <p className="settings-hint">Theme follows your OS unless overridden here.</p>
      <div className="settings-row">
        <div className="ui-segment" role="group" aria-label="Theme">
          {OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={theme === value}
              className={`ui-segment-option pixel${theme === value ? ' ui-segment-option--active' : ''}`}
              onClick={() => pick(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
