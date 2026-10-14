/** Theme choice: what you picked, and what that resolves to right now. */

export type ThemeChoice = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

/** The setting, in the app's own store, so it sits with everything else. */
export const THEME_KEY = 'ui:theme'

/**
 * A mirror in localStorage.
 *
 * The store is IndexedDB and therefore async, so reading it cannot happen before the
 * first paint — a dark-mode user would get a white flash on every load. localStorage
 * is synchronous, so index.html can read this and set the theme before anything is
 * drawn. It is a cache, not a second source of truth.
 */
export const THEME_MIRROR_KEY = 'inkling:theme'

export const THEME_CHOICES: Array<{ id: ThemeChoice; label: string }> = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'Match the system' },
]

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function readMirror(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_MIRROR_KEY)
    return isThemeChoice(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function writeMirror(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_MIRROR_KEY, choice)
  } catch {
    // Private mode, or storage disabled. The store still has it.
  }
}

export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return choice
}

/** Put the resolved theme on the document, where the CSS variables pick it up. */
export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b0b0f' : '#f1f1f4')
}
