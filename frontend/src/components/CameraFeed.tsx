import { useEffect, useState } from 'react'

type CameraFeedProps = {
  spaceId: number
}

/**
 * Live MJPEG stream coming from the backend. The `<img>` is keyed by
 * the space id + a refresh counter so React tears it down and re-mounts
 * (which forces the browser to drop the old connection and open a new
 * one) when the user picks a different space or hits "재연결".
 */
export function CameraFeed({ spaceId }: CameraFeedProps) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState(false)

  // Reset the error state whenever we move to a different space.
  useEffect(() => {
    setError(false)
    setRefreshKey((k) => k + 1)
  }, [spaceId])

  const src = `/api/v1/spaces/${spaceId}/stream`

  return (
    <div className="camera-feed">
      <div className="camera-feed__header">
        <span className="camera-feed__label">
          <span className="camera-feed__dot" aria-hidden /> LIVE · space-{spaceId}
        </span>
        <button
          type="button"
          className="camera-feed__reconnect"
          onClick={() => {
            setError(false)
            setRefreshKey((k) => k + 1)
          }}
        >
          재연결
        </button>
      </div>
      <div className="camera-feed__viewport">
        {!error ? (
          <img
            key={`${spaceId}-${refreshKey}`}
            src={src}
            alt={`공간 ${spaceId} 실시간 카메라`}
            className="camera-feed__img"
            onError={() => setError(true)}
          />
        ) : (
          <div className="camera-feed__error" role="alert">
            <p>스트림에 연결할 수 없습니다.</p>
            <button
              type="button"
              onClick={() => {
                setError(false)
                setRefreshKey((k) => k + 1)
              }}
            >
              다시 시도
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
