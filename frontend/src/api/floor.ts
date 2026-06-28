import type {
  CountUpdate,
  FloorData,
  LatestDetectionResponse,
} from '../types/floor'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''

export async function fetchFloor(): Promise<FloorData> {
  return requestJson<FloorData>('/api/v1/floor')
}

export async function updateSpaceCount(
  spaceId: number,
  payload: CountUpdate,
): Promise<void> {
  await requestJson<unknown>(`/api/v1/spaces/${spaceId}/count`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export async function fetchLatestDetection(): Promise<LatestDetectionResponse> {
  return requestJson<LatestDetectionResponse>('/api/v1/detections/latest')
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, init)

  if (!response.ok) {
    throw new Error(`Backend returned ${response.status}`)
  }

  // 202 Accepted from the count update has no JSON body; tolerate that.
  if (response.status === 204) {
    return undefined as T
  }

  const text = await response.text()
  if (!text) {
    return undefined as T
  }
  return JSON.parse(text) as T
}
