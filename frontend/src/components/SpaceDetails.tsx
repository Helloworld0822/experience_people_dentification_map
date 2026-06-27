import { useEffect, useRef, useState } from 'react'

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
  onBump,
  onClose,
}: SpaceDetailsProps) {
  const panelRef = useRef<HTMLElement>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

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

  const bumpWithGuard = async (
    delta: number,
    options?: { confirmMessage?: string },
  ) => {
    if (isSubmitting) return
    if (options?.confirmMessage && !window.confirm(options.confirmMessage)) {
      return
    }
    setIsSubmitting(true)
    try {
      await onBump(delta)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!space) {
    return (
      <aside className="space-details space-details--empty">
        <div className="space-details__placeholder" aria-hidden="true">
          <span>⌖</span>
        </div>
        <p className="space-details__hint">
          평면도의 공간을 선택하면 상세 정보, 실시간 카메라, 인원수 조정 도구가 표시됩니다.
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
        aria-busy={isSubmitting}
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

        <div className="space-details__actions" role="group" aria-label="인원 수 조정">
          <button
            type="button"
            onClick={() => void bumpWithGuard(-1)}
            disabled={isSubmitting}
          >
            −1
          </button>
          <button
            type="button"
            onClick={() => void bumpWithGuard(1)}
            disabled={isSubmitting}
          >
            +1
          </button>
          <button
            type="button"
            onClick={() => void bumpWithGuard(5)}
            disabled={isSubmitting}
          >
            +5
          </button>
          <button
            type="button"
            className="space-details__reset"
            onClick={() =>
              void bumpWithGuard(-count, {
                confirmMessage: '현재 인원을 0명으로 초기화할까요?',
              })
            }
            disabled={isSubmitting || count === 0}
          >
            0으로
          </button>
        </div>
        {isSubmitting && (
          <p className="space-details__busy" role="status">
            인원 정보를 업데이트하는 중입니다…
          </p>
        )}
        <CameraFeed spaceId={space.id} />
      </aside>
    </>
  )
}
