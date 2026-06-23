import { useEffect, useState } from 'react'

type CameraFeedProps = {
  spaceId: number
}

/**
 * Live MJPEG stream coming from the backend.
 *
 * - When the user picks a different space, we change `<img key>` to
 *   force React to unmount/remount the element so the browser drops
 *   the old connection and opens a new one for the new space.
 * - The reconnect button increments a refresh counter that also
 *   changes the `key`, doing the same thing on demand.
 * - `cache-bust` query string is added so Chrome never serves a stale
 *   cached partial response.
 */
export function CameraFeed({ spaceId }: CameraFeedProps) {
  const [instanceId, setInstanceId] = useState(() => spaceId)
  const [tick, setTick] = useState(0)
  const [error, setError] = useState(false)

  // Force a fresh <img> (and therefore a fresh connection) whenever
  // the user navigates to a different space.
  useEffect(() => {
    setError(false)
    setInstanceId(spaceId)
  }, [spaceId])

  const reconnect = () => {
    setError(false)
    setTick((t) => t + 1)
  }

  const src = `/api/v1/spaces/${spaceId}/stream?n=${instanceId}-${tick}`

  return (
    <div className="camera-feed">
      <div className="camera-feed__header">
        <span className="camera-feed__label">
          <span className="camera-feed__dot" aria-hidden /> LIVE · space-{spaceId}
        </span>
        <button type="button" className="camera-feed__reconnect" onClick={reconnect}>
          재연결
        </button>
      </div>
      <div className="camera-feed__viewport">
        {!error ? (
          <img
            key={`${spaceId}-${instanceId}-${tick}`}
            src={src}
            alt={`공간 ${spaceId} 실시간 카메라`}
            className="camera-feed__img"
            onError={() => setError(true)}
          />
        ) : (
          <div className="camera-feed__error" role="alert">
            <p>스트림에 연결할 수 없습니다.</p>
            <button type="button" onClick={reconnect}>
              다시 시도
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
