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
            <stop offset="0%" stopColor={z.color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={z.color} stopOpacity="0.10" />
          </linearGradient>
        ))}
      </defs>

      {/* Outer building outline */}
      <rect
        x={10}
        y={10}
        width={viewbox.width - 20}
        height={viewbox.height - 20}
        rx={14}
        className="floor-map__outline"
      />

      {/* Zone backgrounds (group click clears the selected space) */}
      {zones.map((z) => {
        const spacesInZone = spaces.filter((s) => s.zone === z.id)
        if (spacesInZone.length === 0) return null
        const minX = Math.min(...spacesInZone.map((s) => s.x))
        const minY = Math.min(...spacesInZone.map((s) => s.y))
        const maxX = Math.max(...spacesInZone.map((s) => s.x + s.width))
        const maxY = Math.max(...spacesInZone.map((s) => s.y + s.height))
        const isDimmed = selectedZone !== null && selectedZone !== z.id
        return (
          <g
            key={`zone-bg-${z.id}`}
            className={`zone-bg ${isDimmed ? 'is-dimmed' : ''} ${selectedZone === z.id ? 'is-active' : ''}`}
            onClick={() => onSelectZone(selectedZone === z.id ? null : z.id)}
          >
            <rect
              x={minX - 8}
              y={minY - 8}
              width={maxX - minX + 16}
              height={maxY - minY + 16}
              rx={10}
              fill={`url(#zone-grad-${z.id})`}
            />
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
        return (
          <g
            key={space.id}
            className={`space ${isSelected ? 'is-selected' : ''} ${
              isDimmed ? 'is-dimmed' : ''
            }`}
            onClick={() => onSelectSpace(space)}
            role="button"
            tabIndex={0}
            aria-label={`${space.title_ko} (${count}명)`}
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
              rx={6}
              className="space__rect"
            />
            <foreignObject
              x={space.x + 4}
              y={space.y + space.height - 24}
              width={Math.max(space.width - 8, 50)}
              height={20}
            >
              <div
                className={
                  space.width < 100
                    ? 'space__title space__title--narrow'
                    : 'space__title'
                }
              >
                {space.title_ko}
              </div>
            </foreignObject>

            {/* Numbered badge + count */}
            {space.badge_anchor && (
              <g
                transform={`translate(${space.badge_anchor[0]}, ${space.badge_anchor[1]})`}
                className={`badge ${space.width < 100 ? 'badge--compact' : ''}`}
              >
                <circle
                  r={space.width < 100 ? 16 : 26}
                  className="badge__bg"
                />
                <text
                  className="badge__num"
                  textAnchor="middle"
                  dominantBaseline="central"
                  style={{
                    fontSize: space.width < 100 ? 14 : 22,
                  }}
                >
                  {space.id}
                </text>
                {space.width >= 100 && (
                  <g transform="translate(20, 22)">
                    <rect
                      x={-2}
                      y={-12}
                      width={48}
                      height={24}
                      rx={12}
                      className="badge__count-bg"
                    />
                    <text
                      className="badge__count"
                      x={22}
                      y={0}
                      textAnchor="middle"
                      dominantBaseline="central"
                    >
                      {count}명
                    </text>
                  </g>
                )}
                {space.width < 100 && (
                  <text
                    className="badge__count badge__count--inline"
                    x={0}
                    y={space.width < 100 ? 30 : 0}
                    textAnchor="middle"
                  >
                    {count}명
                  </text>
                )}
              </g>
            )}
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
