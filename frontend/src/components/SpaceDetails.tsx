import { useEffect, useRef } from 'react'

import type { Space } from '../types/floor'
import { formatClock, relativeAgo } from '../utils/formatFloor'
import { CameraFeed } from './CameraFeed'

type SpaceDetailsProps = {
  space: Space | null
  count: number
  updatedAtMs: number | null
  onClose: () => void
}

/**
 * Space details panel.
 *
 * Desktop: sticky sidebar.
 * Mobile/Tablet: bottom sheet with backdrop, swipe handle, Escape close.
 */
export function SpaceDetails({
  space,
  count,
  updatedAtMs,
  onClose,
}: SpaceDetailsProps) {
  const panelRef = useRef<HTMLElement>(null)

  // Modal-like keyboard behavior:
  // - Escape closes
  // - Tab stays inside panel while it is open
  // - focus returns to previously focused element on close
  useEffect(() => {
    if (!space) return

    const panel = panelRef.current
    const previousActive = document.activeElement as HTMLElement | null
    panel?.focus()

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panel) return

      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusable.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (e.shiftKey) {
        if (active === first || active === panel) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('keydown', handler)
      previousActive?.focus()
    }
  }, [space, onClose])

  if (!space) {
    return (
      <aside className="space-details space-details--empty">
        <div className="space-details__placeholder" aria-hidden="true">
          <span>⌖</span>
        </div>
        <p className="space-details__hint">
          평면도의 공간을 선택하면 상세 정보와 실시간 카메라, 현재 인원이 표시됩니다.
        </p>
      </aside>
    )
  }

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className="space-details-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        className="space-details"
        role="dialog"
        aria-modal="true"
        aria-label={`${space.title_ko} 상세 정보`}
        aria-live="polite"
        tabIndex={-1}
      >
        {/* Mobile swipe handle */}
        <div className="space-details__handle" aria-hidden="true">
          <span className="space-details__handle-bar" />
        </div>

        <div className="space-details__hero">
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
          <div>
            <span className="space-details__tag">Level 1 · Experience</span>
            <h2 className="space-details__title">{space.title_ko}</h2>
            <p className="space-details__sub">{space.title_en}</p>
          </div>
        </div>

        <div className="space-details__body">
          <p className="space-details__desc">{space.description_ko}</p>

          <div className="space-details__count">
            <p className="eyebrow">현재 인원</p>
            <p className="space-details__count-value">{count}<span>명</span></p>
            <p className="space-details__updated">
              최근 업데이트 {formatClock(updatedAtMs)} ({relativeAgo(updatedAtMs)})
            </p>
          </div>
        </div>
        <CameraFeed spaceId={space.id} currentCount={count} />
      </aside>
    </>
  )
}
