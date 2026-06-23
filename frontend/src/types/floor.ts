export type ZoneId = 'learning' | 'leisure' | 'health' | 'cognitive'

export type Zone = {
  id: ZoneId
  label_ko: string
  color: string
}

export type ViewBox = {
  width: number
  height: number
}

export type Space = {
  id: number
  zone: ZoneId
  title_ko: string
  title_en: string
  description_ko: string
  x: number
  y: number
  width: number
  height: number
  badge_anchor: [number, number] | null
}

export type SpaceCount = {
  space_id: number
  count: number
  updated_at_ms: number
}

export type FloorData = {
  viewbox: ViewBox
  zones: Zone[]
  spaces: Space[]
  counts: SpaceCount[]
  generated_at_ms: number
}

export type CountUpdate = {
  count: number
}
