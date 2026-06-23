import type { Zone, ZoneId } from '../types/floor'

type ZoneLegendProps = {
  zones: Zone[]
  selectedZone: ZoneId | null
  onSelect: (zone: ZoneId | null) => void
  totalsByZone: Record<ZoneId, number>
}

export function ZoneLegend({
  zones,
  selectedZone,
  onSelect,
  totalsByZone,
}: ZoneLegendProps) {
  return (
    <div className="zone-legend" role="list">
      <button
        type="button"
        role="listitem"
        className={`zone-chip zone-chip--all ${selectedZone === null ? 'is-active' : ''}`}
        onClick={() => onSelect(null)}
        aria-pressed={selectedZone === null}
      >
        <span className="zone-chip__dot" style={{ background: '#1b1f23' }} />
        <span className="zone-chip__label">전체</span>
      </button>
      {zones.map((zone) => (
        <button
          key={zone.id}
          type="button"
          role="listitem"
          className={`zone-chip ${selectedZone === zone.id ? 'is-active' : ''}`}
          onClick={() => onSelect(selectedZone === zone.id ? null : zone.id)}
          aria-pressed={selectedZone === zone.id}
          style={{ ['--zone-color' as never]: zone.color }}
        >
          <span
            className="zone-chip__dot"
            style={{ background: zone.color }}
            aria-hidden
          />
          <span className="zone-chip__label">{zone.label_ko}</span>
          <span className="zone-chip__count">
            {totalsByZone[zone.id] ?? 0}명
          </span>
        </button>
      ))}
    </div>
  )
}
