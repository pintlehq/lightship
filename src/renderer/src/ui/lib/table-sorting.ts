export type SortValue = string | number | readonly number[] | null | undefined

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function normalize(value: unknown): SortValue {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text || ['—', '-', '<unknown>', 'N/A'].includes(text)) return undefined
    return /^[-+]?\d+(?:\.\d+)?$/.test(text) ? Number(text) : text
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'number')) return value
  return undefined
}

/** TanStack reverses comparisons for descending sorts; compensate only for missing values
 * so unavailable data stays last in both directions. Equal values keep source order. */
export function compareSortValues(a: unknown, b: unknown, descending = false): number {
  const left = normalize(a)
  const right = normalize(b)
  if (left == null || right == null) {
    const order = left == null ? (right == null ? 0 : 1) : -1
    return descending ? -order : order
  }
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (Array.isArray(left) && Array.isArray(right)) {
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const difference = (left[i] ?? 0) - (right[i] ?? 0)
      if (difference) return difference
    }
    return 0
  }
  return collator.compare(String(left), String(right))
}

/** Display ages can contain several units (e.g. Kubernetes printer columns: "2d3h"). */
export function durationValue(value: string): number | undefined {
  const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, y: 31536000 }
  const text = value.trim()
  if (!/^(?:\d+(?:\.\d+)?[smhdwy])+$/.test(text)) return undefined
  return Array.from(text.matchAll(/(\d+(?:\.\d+)?)([smhdwy])/g)).reduce(
    (total, match) => total + Number(match[1]) * units[match[2]],
    0
  )
}

export function cpuValue(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)([num]?)$/.exec(value.trim())
  if (!match) return undefined
  const units: Record<string, number> = { '': 1, n: 1e-9, u: 1e-6, m: 1e-3 }
  return Number(match[1]) * units[match[2]]
}

export function byteValue(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)([KMGTPE]i?B?|B)?$/.exec(value.trim())
  if (!match) return undefined
  const unit = match[2] ?? ''
  const power = 'KMGTPE'.indexOf(unit[0]) + 1
  return Number(match[1]) * (unit.includes('i') ? 1024 : 1000) ** power
}

export function readinessValue(value: string): readonly number[] | undefined {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(value.trim())
  return match ? [Number(match[1]), Number(match[2])] : undefined
}
