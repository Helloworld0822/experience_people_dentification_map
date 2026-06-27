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
        <div className="topbar">
          <div className="topbar__brand">
            <div className="topbar__logo" aria-hidden>서울</div>
            <div>
              <h1 className="topbar__title">경험관 평면도</h1>
              <p className="topbar__subtitle">서울디지털동행플라자</p>
            </div>
          </div>
        </div>
        <p className="loading" role="status">
          <span aria-hidden="true">⏳</span> 잠깐만 기다려 주세요…
        </p>
      </main>
    )
  }

  if (!floor) {
    return (
      <main className="app-shell">
        <div className="topbar">
          <div className="topbar__brand">
            <div className="topbar__logo" aria-hidden>서울</div>
            <div>
              <h1 className="topbar__title">경험관 평면도</h1>
              <p className="topbar__subtitle">서울디지털동행플라자</p>
            </div>
          </div>
        </div>
        <ErrorMessage message={error ?? '데이터를 불러올 수 없습니다. 와이파이가 연결되어 있는지 확인해 주세요.'} />
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
        <div className="topbar__brand">
          <div className="topbar__logo" aria-hidden>SD</div>
          <div>
            <p className="eyebrow">Smart Directory</p>
            <h1 className="topbar__title">서울디지털동행플라자</h1>
          </div>
        </div>
        <label className="topbar__search">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">공간 검색</span>
          <input placeholder="공간, 체험, 시설 검색..." type="search" />
        </label>
        <nav className="topbar__nav" aria-label="주요 메뉴">
          <a className="is-active" href="#map">Map</a>
          <a href="#directory">Directory</a>
          <a href="#status">Status</a>
        </nav>
        <FontSizeToggle value={scale} onChange={setScale} />
      </header>

      <section className="content">
        <aside className="side-nav" id="directory" aria-label="구역 필터">
          <div className="side-nav__intro">
            <p className="eyebrow">Categories</p>
            <h2>공간 둘러보기</h2>
            <p>구역을 선택하면 평면도와 상세 정보가 함께 좁혀집니다.</p>
          </div>
          <ZoneLegend
            zones={floor.zones}
            selectedZone={selectedZone}
            onSelect={setSelectedZone}
            totalsByZone={totalsByZone}
          />
          <div className="live-card" id="status">
            <p className="eyebrow">Live Status</p>
            <div className="live-card__row">
              <span className="live-card__pulse" aria-hidden="true" />
              <strong>{totalPeople}명 이용 중</strong>
            </div>
            <p>마지막 동기화 {formatClock(lastUpdatedMs)} ({relativeAgo(lastUpdatedMs)})</p>
            <button
              type="button"
              className="topbar__refresh"
              onClick={() => void refresh()}
              disabled={isLoading}
              aria-label="새로고침"
            >
              {isLoading ? '동기화 중…' : '새로고침'}
            </button>
          </div>
        </aside>

        <section className="map-canvas" id="map" aria-label="경험관 지도">
          <div className="map-canvas__header">
            <div>
              <p className="eyebrow">Floor Map</p>
              <h2>실시간 경험관 안내도</h2>
            </div>
            <span>{selectedZone ? '필터 적용됨' : '전체 공간'}</span>
          </div>
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
          <div className="map-controls" aria-hidden="true">
            <button type="button">+</button>
            <button type="button">−</button>
            <button type="button">◎</button>
          </div>
        </section>

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
        <span>서울디지털동행플라자 스마트 안내 시스템</span>
        <span>5초마다 자동 갱신</span>
      </footer>
    </main>
  )
}
