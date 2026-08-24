type SparkColor = 'primary' | 'warning'

/** A small responsive area+line chart for a 0–100 percentage series.
 *  Stretches to its container via a non-uniform viewBox. */
export function Sparkline({ data, color = 'primary' }: { data: number[]; color?: SparkColor }) {
  const stroke = `rgb(var(--${color}))`
  const fill = `rgb(var(--${color}) / 0.15)`

  if (data.length < 2) {
    return <div className="grid h-full place-items-center text-[11px] text-faint">collecting…</div>
  }

  const n = data.length
  const x = (i: number): number => (i / (n - 1)) * 100
  const y = (v: number): number => 100 - Math.max(0, Math.min(100, v))
  const line = data.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const area = `0,100 ${line} 100,100`

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
      <polygon points={area} fill={fill} />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
