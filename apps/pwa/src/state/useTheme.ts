import { useCallback, useEffect, useState } from 'react'
import {
  type ResolvedTheme,
  THEME_KEY,
  type ThemeChoice,
  applyTheme,
  isThemeChoice,
  readMirror,
  resolveTheme,
  writeMirror,
} from '../theme'
import { storage } from './useInkling'

/**
 * The theme, applied and kept in step with the system.
 *
 * The stored choice is the source of truth; the localStorage mirror only exists so
 * the first paint can be the right colour.
 */
export function useTheme() {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => readMirror())
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readMirror()))

  useEffect(() => {
    void storage()
      .init()
      .then(async () => {
        const stored = await storage().getSetting(THEME_KEY)
        if (isThemeChoice(stored)) setChoiceState(stored)
      })
  }, [])

  useEffect(() => {
    const apply = () => {
      const next = resolveTheme(choice)
      setResolved(next)
      applyTheme(next)
    }
    apply()

    if (choice !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [choice])

  const setChoice = useCallback(async (next: ThemeChoice) => {
    writeMirror(next)
    setChoiceState(next)
    const store = storage()
    await store.init()
    await store.setSetting(THEME_KEY, next)
  }, [])

  return { choice, resolved, setChoice }
}
