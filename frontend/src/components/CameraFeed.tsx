import { useEffect, useMemo, useState } from 'react'

import { fetchLatestDetection } from '../api/floor'

type CameraFeedProps = {
  spaceId: number
  currentCount: number
}

function densityFromCount(count: number): string {
  if (count >= 16) return '매우 혼잡'
  if (count >= 11) return '혼잡'
  if (count >= 5) return '보통'
  return '여유'
}

export function CameraFeed({ spaceId, currentCount }: CameraFeedProps) {
  const [error, setError] = useState<string | null>(null)
  const [density, setDensity] = useState<string | null>(null)
  const [cameraId, setCameraId] = useState<string | null>(null)
  const [inferenceMs, setInferenceMs] = useState<number | null>(null)
  const [tick, setTick] = useState(0)

  const streamBaseUrl = useMemo(() => {
    const host = window.location.hostname || '127.0.0.1'
    return `http://${host}:8765/api/v1/live/stream`
  }, [])

  const streamUrl = `${streamBaseUrl}?space=${spaceId}&n=${tick}`

  useEffect(() => {
    setDensity(null)
    setCameraId(null)
    setInferenceMs(null)
  }, [spaceId])

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const latest = await fetchLatestDetection()
        if (cancelled) return
        const detection = latest.detection
        if (detection && (detection.space_id === null || detection.space_id === spaceId)) {
          setDensity(detection.density_level ?? densityFromCount(currentCount))
          setInferenceMs(detection.inference_ms ?? null)
          setCameraId(detection.camera_id)
        } else {
          setDensity((prev) => prev ?? densityFromCount(currentCount))
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '최신 탐지값을 읽지 못했습니다.')
        }
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 2000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [spaceId, currentCount])

  return (
    <div className="camera-feed">
      <div className="camera-feed__viewport">
        <img
          key={`${spaceId}-${tick}`}
          src={streamUrl}
          title={`공간 ${spaceId} 실시간 카메라`}
          className="camera-feed__img"
          alt={`공간 ${spaceId} 실시간 카메라`}
          onError={() =>
            setError('8765에서 카메라를 먼저 시작해야 합니다. 8765 화면에서 카메라 연결 후 재연결을 눌러주세요.')
          }
        />
        <div className="camera-feed__metrics" role="status" aria-live="polite">
          <p>사람 수: {currentCount}명</p>
          <p>밀집도: {density ?? densityFromCount(currentCount)}</p>
          <p>추론: {inferenceMs !== null ? `${Math.round(inferenceMs)}ms` : '대기'}</p>
          <p>카메라: {cameraId ?? '연결 대기'}</p>
        </div>
        {error && (
          <div className="camera-feed__error" role="alert">
            <p>{error}</p>
          </div>
        )}
      </div>
      <button
        type="button"
        className="camera-feed__reconnect"
        onClick={() => {
          setError(null)
          setTick((value) => value + 1)
        }}
      >
        재연결
      </button>
    </div>
  )
}
