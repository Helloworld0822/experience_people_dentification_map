import { useMemo, useState } from 'react'

import { useFloor } from '../hooks/useFloor'
import { useFontScale } from '../hooks/useFontScale'
import { formatClock, relativeAgo } from '../utils/formatFloor'
import type { ZoneId } from '../types/floor'
import { ErrorMessage } from './ErrorMessage'
import { FloorPlanMap } from './FloorPlanMap'
import { FontSizeToggle } from './FontSizeToggle'
import { SpaceDetails } from './SpaceDetails'
import { ZoneLegend } from './ZoneLegend'

export function FloorDashboard() {
  const {
    floor,
    isLoading,
    error,
    lastUpdatedMs,
    selectedSpace,
    selectSpace,
    countFor,
    totalPeople,
    bumpCount,
    refresh,
  } = useFloor()
  const [selectedZone, setSelectedZone] = useState<ZoneId | null>(null)
  const { scale, setScale } = useFontScale()

  const totalsByZone = useMemo(() => {
    const out: Record<ZoneId, number> = {
      learning: 0,
      leisure: 0,
      health: 0,
      cognitive: 0,
    }
    if (!floor) return out
    for (const space of floor.spaces) {
      out[space.zone] += countFor(space.id)
    }
    return out
  }, [floor, countFor])

  if (isLoading && !floor) {
    return (
      <main className="app-shell">
        <p className="loading">평면도 데이터를 불러오는 중…</p>
      </main>
    )
  }

  if (!floor) {
    return (
      <main className="app-shell">
        <ErrorMessage message={error ?? '데이터를 불러올 수 없습니다.'} />
      </main>
    )
  }

  const selectedCount = selectedSpace ? countFor(selectedSpace.id) : 0
  const selectedUpdatedAtMs =
    floor.counts.find((c) => c.space_id === selectedSpace?.id)
      ?.updated_at_ms ?? null

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">체험형 인지건강센터 · 실시간 인원</p>
          <h1 className="topbar__title">경험관 평면도</h1>
        </div>
        <FontSizeToggle value={scale} onChange={setScale} />
        <div className="topbar__meta">
          <div className="topbar__stat">
            <p className="eyebrow">총 인원</p>
            <p className="topbar__stat-value">{totalPeople}명</p>
          </div>
          <div className="topbar__stat">
            <p className="eyebrow">마지막 동기화</p>
            <p className="topbar__stat-value">{formatClock(lastUpdatedMs)}</p>
            <p className="topbar__stat-sub">
              ({relativeAgo(lastUpdatedMs)})
            </p>
          </div>
          <button
            type="button"
            className="topbar__refresh"
            onClick={() => void refresh()}
            disabled={isLoading}
          >
            {isLoading ? '동기화 중…' : '새로고침'}
          </button>
        </div>
      </header>

      <ZoneLegend
        zones={floor.zones}
        selectedZone={selectedZone}
        onSelect={setSelectedZone}
        totalsByZone={totalsByZone}
      />

      <section className="content">
        <div className="map-frame">
          <FloorPlanMap
            floor={floor}
            countFor={countFor}
            selectedSpaceId={selectedSpace?.id ?? null}
            selectedZone={selectedZone}
            onSelectSpace={selectSpace}
            onSelectZone={setSelectedZone}
          />
        </div>
        <SpaceDetails
          space={selectedSpace}
          count={selectedCount}
          updatedAtMs={selectedUpdatedAtMs}
          onBump={async (delta) => {
            if (selectedSpace) {
              await bumpCount(selectedSpace.id, delta)
            }
          }}
          onClose={() => selectSpace(null)}
        />
      </section>

      <ErrorMessage message={error} />

      <footer className="app-footer">
        <span>API: {import.meta.env.VITE_API_BASE_URL || '/api (프록시)'}</span>
        <span>· 5초마다 자동 갱신</span>
      </footer>
    </main>
  )
}
