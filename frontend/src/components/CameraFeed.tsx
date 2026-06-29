import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { fetchLatestDetection, updateSpaceCount } from '../api/floor'

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

function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Frame encoding failed'))),
      type,
      quality,
    )
  })
}

export function CameraFeed({ spaceId, currentCount }: CameraFeedProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectTimerRef = useRef<number | undefined>(undefined)
  const detectingRef = useRef(false)
  const blobUrlRef = useRef<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [density, setDensity] = useState<string | null>(null)
  const [cameraId, setCameraId] = useState<string | null>(null)
  const [inferenceMs, setInferenceMs] = useState<number | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [localCameraReady, setLocalCameraReady] = useState(false)

  const isMobile = useMemo(() => isMobileDevice(), [])
  const streamUrl = `/live/api/v1/live/stream?space=${spaceId}&n=${reloadKey}`

  const stopLocalCamera = useCallback(() => {
    window.clearTimeout(detectTimerRef.current)
    detectTimerRef.current = undefined
    detectingRef.current = false
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    const video = videoRef.current
    if (video) {
      video.pause()
      video.srcObject = null
    }
    setLocalCameraReady(false)
    void fetch(`/live/api/v1/live/clear?space=${spaceId}`, { method: 'POST' }).catch(() => {})
  }, [spaceId])

  const getCameraStream = useCallback(async (): Promise<MediaStream> => {
    const preferred = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    }
    try {
      return await navigator.mediaDevices.getUserMedia(preferred)
    } catch {
      return navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
    }
  }, [])

  const processLocalFrame = useCallback(async () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !streamRef.current || video.readyState < 2) return

    const sourceWidth = video.videoWidth
    const sourceHeight = video.videoHeight
    if (!sourceWidth || !sourceHeight) return

    const scale = Math.min(1, 1280 / sourceWidth)
    canvas.width = Math.round(sourceWidth * scale)
    canvas.height = Math.round(sourceHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.88)
    await fetch(`/live/api/v1/live/frame?space=${spaceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: blob,
    })

    const detectRes = await fetch('/live/api/detect?conf=0.25&dense=true', {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: blob,
    })
    if (!detectRes.ok) return

    const result = await detectRes.json()
    await updateSpaceCount(spaceId, { count: result.count })
    setDensity(densityFromLevel(result.density?.level, result.count))
    setInferenceMs(result.inference_ms ?? null)
    setCameraId('mobile-camera')
    setError(null)
  }, [spaceId])

  const scheduleLocalDetect = useCallback(() => {
    window.clearTimeout(detectTimerRef.current)
    detectTimerRef.current = window.setTimeout(async () => {
      if (!streamRef.current) return
      if (detectingRef.current) {
        scheduleLocalDetect()
        return
      }
      detectingRef.current = true
      try {
        await processLocalFrame()
      } catch {
        // Keep camera running even if a single frame fails.
      } finally {
        detectingRef.current = false
        if (streamRef.current) scheduleLocalDetect()
      }
    }, 280)
  }, [processLocalFrame])

  const startLocalCamera = useCallback(async () => {
    stopLocalCamera()
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('이 브라우저는 카메라를 지원하지 않습니다.')
      return
    }
    try {
      const stream = await getCameraStream()
      streamRef.current = stream
      const video = videoRef.current
      if (!video) return
      video.muted = true
      video.playsInline = true
      video.setAttribute('playsinline', 'true')
      video.srcObject = stream
      await video.play()
      setLocalCameraReady(true)
      setCameraId('mobile-camera')
      setError(null)
      scheduleLocalDetect()
    } catch (err) {
      setLocalCameraReady(false)
      const isSecure = window.isSecureContext
      const message =
        err instanceof Error && err.name === 'NotAllowedError'
          ? '카메라 권한을 허용해 주세요.'
          : !isSecure
            ? 'iPhone은 HTTPS 접속이 필요합니다. https://<PC-IP>:3443 으로 접속해 주세요.'
            : `카메라를 시작하지 못했습니다: ${err instanceof Error ? err.message : 'unknown'}`
      setError(message)
    }
  }, [getCameraStream, scheduleLocalDetect, stopLocalCamera])

  useEffect(() => {
    setDensity(null)
    setCameraId(null)
    setInferenceMs(null)
    setError(null)
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
          (detection.space_id === null || detection.space_id === spaceId)
        ) {
          setDensity(
            densityFromLevel(detection.density_level, detection.people_count),
          )
          setInferenceMs(detection.inference_ms ?? null)
          if (!localCameraReady) setCameraId(detection.camera_id)
        } else if (!localCameraReady) {
          setDensity((prev) => prev ?? densityFromCount(currentCount))
        }
      } catch {
        if (!cancelled && !localCameraReady && currentCount > 0) {
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
  }, [spaceId, currentCount, localCameraReady])

  useEffect(() => {
    if (!isMobile) return
    void startLocalCamera()
    return () => stopLocalCamera()
  }, [isMobile, spaceId, reloadKey, startLocalCamera, stopLocalCamera])

  useEffect(() => {
    if (localCameraReady || !isMobile) return

    let cancelled = false
    let timer: number | undefined

    const pollFrame = async () => {
      try {
        const response = await fetch(
          `/live/api/v1/live/frame?space=${spaceId}&t=${Date.now()}`,
          { cache: 'no-store' },
        )
        if (!response.ok) throw new Error('no frame')
        const blob = await response.blob()
        const nextUrl = URL.createObjectURL(blob)
        if (imgRef.current) {
          if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
          blobUrlRef.current = nextUrl
          imgRef.current.src = nextUrl
        } else {
          URL.revokeObjectURL(nextUrl)
        }
        if (!cancelled) setError(null)
      } catch {
        if (!cancelled) {
          setError('PC 8765에서 카메라를 시작했거나, 아래 버튼으로 폰 카메라를 연결해 주세요.')
        }
      }
      if (!cancelled) timer = window.setTimeout(() => void pollFrame(), 250)
    }

    void pollFrame()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
  }, [isMobile, localCameraReady, spaceId, reloadKey])

  return (
    <div className="camera-feed">
      <div className="camera-feed__viewport">
        {isMobile && (
          <video
            ref={videoRef}
            className={`camera-feed__img${localCameraReady ? '' : ' camera-feed__img--hidden'}`}
            aria-label={`공간 ${spaceId} 폰 카메라`}
            muted
            playsInline
            autoPlay
          />
        )}
        {!isMobile && (
          <img
            ref={imgRef}
            key={`${spaceId}-${reloadKey}`}
            src={streamUrl}
            title={`공간 ${spaceId} 실시간 카메라`}
            className="camera-feed__img"
            alt={`공간 ${spaceId} 실시간 카메라`}
            onLoad={() => setError(null)}
            onError={() =>
              setError('8765에서 카메라를 먼저 시작한 뒤 재연결을 눌러주세요.')
            }
          />
        )}
        {isMobile && !localCameraReady && (
          <img
            ref={imgRef}
            key={`relay-${spaceId}-${reloadKey}`}
            className="camera-feed__img camera-feed__img--fallback"
            alt=""
            aria-hidden
          />
        )}
        <canvas ref={canvasRef} className="camera-feed__canvas" aria-hidden />
        <div className="camera-feed__metrics" role="status" aria-live="polite">
          <p>사람 수: {currentCount}명</p>
          <p>밀집도: {density ?? densityFromCount(currentCount)}</p>
          <p>추론: {inferenceMs !== null ? `${Math.round(inferenceMs)}ms` : '대기'}</p>
          <p>카메라: {cameraId ?? (localCameraReady ? '폰 카메라' : '연결 대기')}</p>
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
          setReloadKey((value) => value + 1)
          if (isMobile) void startLocalCamera()
        }}
      >
        {isMobile ? '카메라 시작' : '재연결'}
      </button>
    </div>
  )
}
