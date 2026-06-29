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

function densityFromLevel(level: string | null | undefined, count: number): string {
  if (!level) return densityFromCount(count)
  const labels: Record<string, string> = {
    empty: '여유',
    single: '여유',
    sparse: '여유',
    normal: '보통',
    dense: '혼잡',
    crowded: '매우 혼잡',
  }
  return labels[level] ?? densityFromCount(count)
}

export function CameraFeed({ spaceId, currentCount }: CameraFeedProps) {
  const [density, setDensity] = useState<string | null>(null)
  const [cameraId, setCameraId] = useState<string | null>(null)
  const [inferenceMs, setInferenceMs] = useState<number | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const modelHost = useMemo(() => window.location.hostname || '127.0.0.1', [])
  const embedUrl = useMemo(
    () =>
      `http://${modelHost}:8765/?embed=camera&space=${spaceId}&v=${reloadKey}`,
    [modelHost, reloadKey, spaceId],
  )

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
        if (
          detection &&
          detection.space_id !== null &&
          detection.space_id === spaceId
        ) {
          setDensity(densityFromLevel(detection.density_level, detection.people_count))
          setInferenceMs(detection.inference_ms ?? null)
          setCameraId(detection.camera_id)
          return
        }
        if (currentCount > 0) {
          setDensity((prev) => prev ?? densityFromCount(currentCount))
        } else {
          setDensity(densityFromCount(0))
          setInferenceMs(null)
          setCameraId(null)
        }
      } catch {
        if (!cancelled && currentCount > 0) {
          setDensity((prev) => prev ?? densityFromCount(currentCount))
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
        <iframe
          key={`${spaceId}-${reloadKey}`}
          src={embedUrl}
          title={`공간 ${spaceId} 실시간 카메라`}
          className="camera-feed__embed"
          allow="camera; microphone"
        />
        <div className="camera-feed__metrics" role="status" aria-live="polite">
          <p>사람 수: {currentCount}명</p>
          <p>밀집도: {density ?? densityFromCount(currentCount)}</p>
          <p>추론: {inferenceMs !== null ? `${Math.round(inferenceMs)}ms` : '대기'}</p>
          <p>카메라: {cameraId ?? '연결 대기'}</p>
        </div>
      </div>
      <button
        type="button"
        className="camera-feed__reconnect"
        onClick={() => setReloadKey((value) => value + 1)}
      >
        재연결
      </button>
    </div>
  )
}
