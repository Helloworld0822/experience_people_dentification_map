const timeFormatter = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

export function formatClock(ms: number | null): string {
  if (ms == null) return '--:--:--'
  return timeFormatter.format(new Date(ms))
}

export function relativeAgo(ms: number | null, now = Date.now()): string {
  if (ms == null) return '아직 데이터 없음'
  const diff = Math.max(0, Math.floor((now - ms) / 1000))
  if (diff < 5) return '방금 업데이트'
  if (diff < 60) return `${diff}초 전`
  const mins = Math.floor(diff / 60)
  if (mins < 60) return `${mins}분 전`
  const hours = Math.floor(mins / 60)
  return `${hours}시간 전`
}
