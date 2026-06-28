import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchFloor, updateSpaceCount } from '../api/floor'
import type { FloorData, Space, SpaceCount } from '../types/floor'

const POLL_MS = 2_000

type UseFloorResult = {
  floor: FloorData | null
  isLoading: boolean
  error: string | null
  lastUpdatedMs: number | null
  selectedSpace: Space | null
  selectSpace: (space: Space | null) => void
  countFor: (spaceId: number) => number
  totalPeople: number
  bumpCount: (spaceId: number, delta: number) => Promise<void>
  setCount: (spaceId: number, value: number) => Promise<void>
  refresh: () => Promise<void>
}

export function useFloor(): UseFloorResult {
  const [floor, setFloor] = useState<FloorData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedSpace, setSelectedSpace] = useState<Space | null>(null)
  const [lastUpdatedMs, setLastUpdatedMs] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const data = await fetchFloor()
      setFloor(data)
      setLastUpdatedMs(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const initial = window.setTimeout(refresh, 0)
    const timer = window.setInterval(refresh, POLL_MS)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [refresh])

  const countById = useMemo(() => {
    const map = new Map<number, SpaceCount>()
    floor?.counts.forEach((c) => map.set(c.space_id, c))
    return map
  }, [floor])

  const countFor = useCallback(
    (spaceId: number) => countById.get(spaceId)?.count ?? 0,
    [countById],
  )

  const totalPeople = useMemo(() => {
    if (!floor) return 0
    return floor.spaces.reduce((acc, s) => acc + countFor(s.id), 0)
  }, [floor, countFor])

  const setCount = useCallback(
    async (spaceId: number, value: number) => {
      const next = Math.max(0, Math.floor(value))
      try {
        await updateSpaceCount(spaceId, { count: next })
        // Optimistic local update so the badge moves before the next poll.
        setFloor((prev) => {
          if (!prev) return prev
          const now = Date.now()
          const others = prev.counts.filter((c) => c.space_id !== spaceId)
          const updated: SpaceCount = {
            space_id: spaceId,
            count: next,
            updated_at_ms: now,
          }
          return {
            ...prev,
            counts: [...others, updated],
            generated_at_ms: now,
          }
        })
        setLastUpdatedMs(Date.now())
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      }
    },
    [],
  )

  const bumpCount = useCallback(
    async (spaceId: number, delta: number) => {
      const current = countFor(spaceId)
      await setCount(spaceId, current + delta)
    },
    [countFor, setCount],
  )

  return {
    floor,
    isLoading,
    error,
    lastUpdatedMs,
    selectedSpace,
    selectSpace: setSelectedSpace,
    countFor,
    totalPeople,
    bumpCount,
    setCount,
    refresh,
  }
}
