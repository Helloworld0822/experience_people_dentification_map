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

const ZONE_LABEL_KO: Record<ZoneId, string> = {
  learning: '학습 · 상담',
  leisure: '여가 · 체험',
  health: '건강 · 운동',
  cognitive: '인지 · 여가',
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
  const { viewbox, spaces, zones } = floor
  const zoneById = useMemo(() => {
    const m = new Map<ZoneId, string>()
    zones.forEach((z) => m.set(z.id, z.color))
    return m
  }, [zones])

  return (
    <svg
      className="floor-map"
      viewBox={`0 0 ${viewbox.width} ${viewbox.height}`}
      role="img"
      aria-label="경험관 평면도"
      preserveAspectRatio="xMidYMid meet"
      style={{ touchAction: 'pan-x pinch-zoom' }}
    >
      <defs>
        {zones.map((z) => (
          <linearGradient
            key={`grad-${z.id}`}
            id={`zone-grad-${z.id}`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor={z.color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={z.color} stopOpacity="0.08" />
          </linearGradient>
        ))}
      </defs>

      {/* Outer building outline */}
      <rect
        x={10}
        y={10}
        width={viewbox.width - 20}
        height={viewbox.height - 20}
        rx={16}
        className="floor-map__outline"
      />

      {/* Compass edge markers (top/bottom/left/right) */}
      <g className="compass-group" pointerEvents="none">
        {([
          ['▲', viewbox.width / 2, 4],
          ['▼', viewbox.width / 2, viewbox.height - 4],
          ['◀', 4, viewbox.height / 2],
          ['▶', viewbox.width - 4, viewbox.height / 2],
        ] as const).map(([glyph, cx, cy]) => (
          <text
            key={glyph + cx + cy}
            x={cx}
            y={cy}
            className="compass__glyph"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {glyph}
          </text>
        ))}
      </g>

      {/* Zone backgrounds (click to filter; click again to clear) */}
      {zones.map((z) => {
        const spacesInZone = spaces.filter((s) => s.zone === z.id)
        if (spacesInZone.length === 0) return null
        const minX = Math.min(...spacesInZone.map((s) => s.x))
        const minY = Math.min(...spacesInZone.map((s) => s.y))
        const maxX = Math.max(...spacesInZone.map((s) => s.x + s.width))
        const maxY = Math.max(...spacesInZone.map((s) => s.y + s.height))
        const isDimmed = selectedZone !== null && selectedZone !== z.id
        const isActive = selectedZone === z.id
        const labelX = minX + 14
        const labelY = minY + 22
        return (
          <g key={`zone-bg-${z.id}`}>
            <g
              className={`zone-bg ${isDimmed ? 'is-dimmed' : ''} ${isActive ? 'is-active' : ''}`}
              onClick={() => onSelectZone(isActive ? null : z.id)}
            >
              <rect
                x={minX - 10}
                y={minY - 10}
                width={maxX - minX + 20}
                height={maxY - minY + 20}
                rx={14}
                fill={`url(#zone-grad-${z.id})`}
              />
            </g>
            <text
              x={labelX}
              y={labelY}
              className="zone-bg-label"
              style={{ fill: z.color }}
            >
              {ZONE_LABEL_KO[z.id]}
            </text>
          </g>
        )
      })}

      {/* Spaces (clickable tiles) */}
      {spaces.map((space) => {
        const isSelected = space.id === selectedSpaceId
        const isDimmed =
          selectedZone !== null && space.zone !== selectedZone
        const count = countFor(space.id)
        const zoneColor = zoneById.get(space.zone) ?? '#1f6feb'
        const isNarrow = space.width < 110
        const badgeBottom = space.y + 28 + (isNarrow ? 14 : 22) + 8
        const pillTop = space.y + space.height - (isNarrow ? 18 : 26) - 14 - 8
        const titleX = space.x + space.width / 2
        const titleY = (badgeBottom + pillTop) / 2 + (isNarrow ? 18 : 8)
        return (
          <g
            key={space.id}
            className={`space ${isSelected ? 'is-selected' : ''} ${
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
            style={{ ['--space-color' as never]: zoneColor }}
          >
            <rect
              x={space.x}
              y={space.y}
              width={space.width}
              height={space.height}
              rx={8}
              className="space__rect"
            />

            {/* Number badge — top-left corner of the tile */}
            <g
              transform={`translate(${space.x + (isNarrow ? 18 : 28)}, ${space.y + (isNarrow ? 20 : 28)})`}
              className={isNarrow ? 'badge badge--compact' : 'badge'}
            >
              <circle r={isNarrow ? 14 : 22} className="badge__bg" />
              <text
                className="badge__num"
                textAnchor="middle"
                dominantBaseline="central"
              >
                {space.id}
              </text>
            </g>

            {/* Title */}
            <text
              x={titleX}
              y={titleY}
              className={
                isNarrow
                  ? 'space__title space__title--narrow'
                  : 'space__title'
              }
              textAnchor="middle"
            >
              {wrapTitle(space.title_ko, isNarrow).map((line, i) => (
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
            {!isNarrow && (
              <text
                x={titleX}
                y={titleY + 22}
                className="space__sub"
                textAnchor="middle"
              >
                {space.title_en}
              </text>
            )}

            {/* People count pill — bottom-right of the tile */}
            <g
              transform={`translate(${space.x + space.width - (isNarrow ? 24 : 36)}, ${space.y + space.height - (isNarrow ? 18 : 26)})`}
              className={isNarrow ? 'count-pill count-pill--compact' : 'count-pill'}
            >
              <rect
                x={-2}
                y={-14}
                width={isNarrow ? 42 : 64}
                height={28}
                rx={14}
                className="count-pill__bg"
              />
              <text
                className="count-pill__num"
                x={isNarrow ? 19 : 30}
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
      <g className="entrance" transform="translate(495, 590)">
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
    </svg>
  )
}
