import { useCallback, useEffect, useState } from 'react'

import type { FontScale } from '../components/FontSizeToggle'

const STORAGE_KEY = 'experience-map:font-scale'
const VALID: FontScale[] = ['base', 'large', 'xlarge']

function isValid(value: string | null): value is FontScale {
  return value !== null && (VALID as string[]).includes(value)
}

function readInitial(): FontScale {
  if (typeof window === 'undefined') return 'base'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return isValid(stored) ? stored : 'base'
}

/**
 * Persist the user's font-scale preference to localStorage and reflect
 * it on the document root via a `data-font-scale` attribute, which
 * the CSS uses to scale every rem-based size on the page.
 */
export function useFontScale(): {
  scale: FontScale
  setScale: (next: FontScale) => void
} {
  const [scale, setScaleState] = useState<FontScale>(readInitial)

  useEffect(() => {
    document.documentElement.setAttribute('data-font-scale', scale)
  }, [scale])

  const setScale = useCallback((next: FontScale) => {
    setScaleState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // localStorage might be blocked — silently ignore.
    }
  }, [])

  return { scale, setScale }
}
