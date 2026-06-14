import { useSyncExternalStore } from 'react'

export type Theme = 'system' | 'light' | 'dark'

const THEME_KEY = 'gnosis.theme'

let listeners: (() => void)[] = []

function getTheme(): Theme {
  const value = typeof localStorage === 'undefined' ? null : localStorage.getItem(THEME_KEY)
  if (value === 'light' || value === 'dark' || value === 'system') return value
  // No saved preference: open cyberpunk. Dark is the default/hero, so a first
  // load is dark regardless of OS instead of silently falling back to light on
  // a light-mode OS. Picking 'System' later still follows the OS.
  return 'dark'
}

/** 'system' clears the override so the prefers-color-scheme blocks apply. */
export function applyTheme(theme: Theme = getTheme()): void {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme)
  applyTheme(theme)
  listeners.forEach((notify) => notify())
}

/** The saved preference, reactive to setTheme — feeds React Flow's colorMode. */
export function useThemePreference(): Theme {
  return useSyncExternalStore((onChange) => {
    listeners.push(onChange)
    return () => {
      listeners = listeners.filter((l) => l !== onChange)
    }
  }, getTheme)
}
