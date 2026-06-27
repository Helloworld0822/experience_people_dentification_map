export type FontScale = 'base' | 'large' | 'xlarge'

type FontSizeToggleProps = {
  value: FontScale
  onChange: (next: FontScale) => void
}

const OPTIONS: Array<{ value: FontScale; label: string; hint: string }> = [
  { value: 'base', label: '보통', hint: '기본 글자 크기 (16px)' },
  { value: 'large', label: '크게', hint: '글자 약 1.2배 (19px)' },
  { value: 'xlarge', label: '매우 크게', hint: '글자 약 1.4배 (22px)' },
]

export function FontSizeToggle({ value, onChange }: FontSizeToggleProps) {
  return (
    <div
      className="font-toggle"
      role="group"
      aria-label="글자 크기"
    >
      <span className="font-toggle__label" aria-hidden>
        글자
      </span>
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`font-toggle__btn ${value === opt.value ? 'is-active' : ''}`}
          aria-pressed={value === opt.value}
          title={opt.hint}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
