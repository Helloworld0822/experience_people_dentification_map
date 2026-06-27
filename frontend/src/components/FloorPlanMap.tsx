import { useMemo } from 'react'

import type { FloorData, Space, ZoneId } from '../types/floor'

type FloorPlanMapProps = {
  floor: FloorData
  countFor: (spaceId: number) => number
  selectedSpaceId: number | null
  selectedZone: ZoneId | null
  onSelectSpace: (space: Space) => void
  onSelectZone: (zone: ZoneId | null) => void
}

type TileLayout = {
  x: number
  y: number
  width: number
  height: number
  compact?: boolean
}

const MAP_VIEWBOX = {
  width: 1000,
  height: 780,
}

const STITCH_ZONE_COLORS: Record<ZoneId, string> = {
  learning: '#1565c0',
  leisure: '#fbc02d',
  health: '#689f38',
  cognitive: '#d81b60',
}

const STITCH_ZONE_TINTS: Record<ZoneId, string> = {
  learning: '#e3f2fd',
  leisure: '#fff9c4',
  health: '#f1f8e9',
  cognitive: '#fce4ec',
}

const TILE_LAYOUTS: Record<number, TileLayout> = {
  1: { x: 40, y: 40, width: 280, height: 200 },
  2: { x: 40, y: 260, width: 280, height: 390 },
  3: { x: 360, y: 40, width: 280, height: 200 },
  4: { x: 360, y: 260, width: 280, height: 390 },
  5: { x: 680, y: 40, width: 280, height: 200 },
  6: { x: 680, y: 260, width: 280, height: 210 },
  7: { x: 680, y: 490, width: 130, height: 75, compact: true },
  8: { x: 830, y: 490, width: 130, height: 75, compact: true },
  9: { x: 680, y: 575, width: 130, height: 75, compact: true },
  10: { x: 830, y: 575, width: 130, height: 75, compact: true },
}

/**
 * Wrap a Korean title into one or two lines so it fits inside narrow
 * tiles. Spaces are kept as natural break points first; if no space
 * exists in the title we just emit the original text on a single line.
 */
function wrapTitle(text: string, narrow: boolean): string[] {
  if (!narrow) return [text]
  const preferMid = Math.ceil(text.length / 2)
  for (let i = preferMid - 2; i <= preferMid + 2; i++) {
    if (i > 0 && i < text.length - 1) {
      const ch = text[i]
      if (ch === ' ' || ch === ',' || ch === '·') {
        return [text.slice(0, i), text.slice(i + 1)]
      }
    }
  }
  return [text.slice(0, preferMid), text.slice(preferMid)]
}

/**
 * Floor plan SVG.
 *
 * Accessibility notes:
 * - Each space is a real <button> with role/tabindex/aria-label.
 * - The number badge and people count are rendered as SVG <text> so
 *   screen-readers can read them; the whole tile is the click target.
 * - Tile text size scales with the global font-scale variable.
 * - Mobile: touch-action: pinch-zoom enables native browser zoom.
 */
export function FloorPlanMap({
  floor,
  countFor,
  selectedSpaceId,
  selectedZone,
  onSelectSpace,
  onSelectZone,
}: FloorPlanMapProps) {
  const { spaces, zones } = floor
  const zoneColorById = useMemo(() => {
    const m = new Map<ZoneId, string>()
    zones.forEach((z) => m.set(z.id, STITCH_ZONE_COLORS[z.id] ?? z.color))
    return m
  }, [zones])
  const toggleZone = (zoneId: ZoneId) => {
    onSelectZone(selectedZone === zoneId ? null : zoneId)
  }

  return (
    <svg
      className="floor-map"
      viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
      role="img"
      aria-label="경험관 평면도"
      preserveAspectRatio="xMidYMid meet"
      style={{ touchAction: 'pan-x pinch-zoom' }}
    >
      <defs>
        <filter id="room-card-shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="10" stdDeviation="14" floodOpacity="0.08" />
        </filter>
      </defs>

      {/* Outer building outline */}
      <rect
        x={10}
        y={10}
        width={MAP_VIEWBOX.width - 20}
        height={690}
        rx={2}
        className="floor-map__outline"
      />

      {/* Spaces (clickable tiles) */}
      {spaces.map((space) => {
        const layout = TILE_LAYOUTS[space.id] ?? {
          x: space.x,
          y: space.y,
          width: space.width,
          height: space.height,
        }
        const isSelected = space.id === selectedSpaceId
        const isDimmed =
          selectedZone !== null && space.zone !== selectedZone
        const count = countFor(space.id)
        const zoneColor = zoneColorById.get(space.zone) ?? '#1f6feb'
        const zoneTint = STITCH_ZONE_TINTS[space.zone] ?? '#ffffff'
        const isCompact = layout.compact === true
        const titleX = layout.x + layout.width / 2
        const titleY = isCompact
          ? layout.y + layout.height / 2 + 5
          : layout.y + layout.height / 2 + 7
        return (
          <g
            key={space.id}
            className={`space room-tile ${isCompact ? 'room-tile--compact' : ''} ${isSelected ? 'is-selected' : ''} ${
              isDimmed ? 'is-dimmed' : ''
            }`}
            onClick={() => onSelectSpace(space)}
            role="button"
            tabIndex={0}
            aria-label={`${space.title_ko} ${count}명`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelectSpace(space)
              }
            }}
            style={{
              ['--space-color' as never]: zoneColor,
              ['--space-tint' as never]: zoneTint,
            }}
          >
            <rect
              x={layout.x}
              y={layout.y}
              width={layout.width}
              height={layout.height}
              rx={2}
              className="space__rect"
            />

            {/* Number badge */}
            <g
              transform={`translate(${layout.x + (isCompact ? layout.width - 16 : 28)}, ${layout.y + (isCompact ? -2 : 28)})`}
              className={isCompact ? 'badge badge--compact badge--floating' : 'badge'}
            >
              <rect
                x={isCompact ? -10 : -14}
                y={isCompact ? -10 : -14}
                width={isCompact ? 20 : 28}
                height={isCompact ? 20 : 28}
                rx={isCompact ? 10 : 2}
                className="badge__bg"
              />
              <text
                className="badge__num"
                textAnchor="middle"
                dominantBaseline="central"
              >
                {space.id}
              </text>
            </g>

            {!isCompact && (
              <text
                x={titleX}
                y={titleY - 46}
                className="room-tile__icon"
                textAnchor="middle"
              >
                {space.id.toString().padStart(2, '0')}
              </text>
            )}

            {/* Title */}
            <text
              x={titleX}
              y={titleY}
              className={isCompact ? 'space__title space__title--narrow' : 'space__title'}
              textAnchor="middle"
            >
              {wrapTitle(space.title_ko, isCompact).map((line, i) => (
                <tspan
                  key={i}
                  x={titleX}
                  dy={i === 0 ? 0 : '1.05em'}
                >
                  {line}
                </tspan>
              ))}
            </text>

            {/* English sub-label (only for wide enough tiles) */}
            {!isCompact && (
              <text
                x={titleX}
                y={titleY + 28}
                className="space__sub"
                textAnchor="middle"
              >
                {space.title_en}
              </text>
            )}

            {/* People count pill — bottom-right of the tile */}
            <g
              transform={`translate(${layout.x + layout.width - (isCompact ? 42 : 78)}, ${layout.y + (isCompact ? layout.height - 12 : layout.height - 30)})`}
              className={isCompact ? 'count-pill count-pill--compact' : 'count-pill'}
            >
              <rect
                x={0}
                y={isCompact ? -10 : -16}
                width={isCompact ? 44 : 74}
                height={isCompact ? 20 : 32}
                rx={isCompact ? 10 : 16}
                fill={zoneColor}
              />
              <text
                className="count-pill__num"
                x={isCompact ? 22 : 37}
                y={0}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {count}명
              </text>
            </g>
          </g>
        )
      })}

      {/* Entrance marker */}
      <g className="entrance" transform="translate(500, 710)">
        <text
          textAnchor="middle"
          className="entrance__label"
          y={18}
        >
          출입구
        </text>
        <path
          d="M -10 0 L 10 0 L 0 -10 Z"
          className="entrance__arrow"
        />
      </g>

      <g className="map-legend" transform="translate(175, 740)">
        {zones.map((zone, index) => {
          const x = index * 190
          const isActive = selectedZone === zone.id
          return (
            <g
              key={zone.id}
              transform={`translate(${x}, 0)`}
              className={`map-legend__item ${isActive ? 'is-active' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`${zone.label_ko} 영역 필터`}
              aria-pressed={isActive}
              onClick={() => toggleZone(zone.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  toggleZone(zone.id)
                }
              }}
            >
              <rect
                x={0}
                y={-8}
                width={16}
                height={16}
                rx={2}
                fill={STITCH_ZONE_TINTS[zone.id]}
                stroke={zoneColorById.get(zone.id)}
              />
              <text x={26} y={4} className="map-legend__label">
                {zone.label_ko}
              </text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}
