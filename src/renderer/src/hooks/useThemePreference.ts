import { useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const storageKey = 'nnote.theme'

export function resolveTheme(
  preference: ThemePreference,
  systemDark: boolean,
): ResolvedTheme {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
}

function storedPreference(): ThemePreference {
  const stored = globalThis.localStorage?.getItem(storageKey)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

export function useThemePreference() {
  const [preference, setPreferenceState] = useState<ThemePreference>(storedPreference)
  const [systemDark, setSystemDark] = useState(
    () => globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  )
  const resolvedTheme = resolveTheme(preference, systemDark)

  useEffect(() => {
    const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return undefined

    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
  }, [resolvedTheme])

  function setPreference(next: ThemePreference) {
    setPreferenceState(next)
    if (next === 'system') localStorage.removeItem(storageKey)
    else localStorage.setItem(storageKey, next)
  }

  return { preference, resolvedTheme, setPreference }
}
