import type { Space } from '../types/floor'
import { formatClock, relativeAgo } from '../utils/formatFloor'
import { CameraFeed } from './CameraFeed'

type SpaceDetailsProps = {
  space: Space | null
  count: number
  updatedAtMs: number | null
  onBump: (delta: number) => Promise<void>
  onClose: () => void
}

export function SpaceDetails({
  space,
  count,
  updatedAtMs,
  onBump,
  onClose,
}: SpaceDetailsProps) {
  if (!space) {
    return (
      <aside className="space-details space-details--empty">
        <p className="space-details__hint">
          평면도의 공간을 선택하면 상세 정보, 실시간 카메라, 인원수 조정
          도구가 표시됩니다.
        </p>
      </aside>
    )
  }

  return (
    <aside className="space-details" aria-live="polite">
      <header className="space-details__header">
        <span className="space-details__id">공간 {space.id}</span>
        <button
          type="button"
          className="space-details__close"
          onClick={onClose}
          aria-label="상세 패널 닫기"
        >
          ×
        </button>
      </header>
      <h2 className="space-details__title">{space.title_ko}</h2>
      <p className="space-details__sub">{space.title_en}</p>
      <p className="space-details__desc">{space.description_ko}</p>

      <CameraFeed spaceId={space.id} />

      <div className="space-details__count">
        <p className="eyebrow">현재 인원</p>
        <p className="space-details__count-value">{count}</p>
        <p className="space-details__updated">
          최근 업데이트 {formatClock(updatedAtMs)} ({relativeAgo(updatedAtMs)})
        </p>
      </div>

      <div className="space-details__actions" role="group" aria-label="인원 수 조정">
        <button type="button" onClick={() => void onBump(-1)}>
          −1
        </button>
        <button type="button" onClick={() => void onBump(1)}>
          +1
        </button>
        <button type="button" onClick={() => void onBump(5)}>
          +5
        </button>
        <button
          type="button"
          className="space-details__reset"
          onClick={() => void onBump(-count)}
        >
          0으로
        </button>
      </div>
    </aside>
  )
}
