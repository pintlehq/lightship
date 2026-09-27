/** CPU quantity → cores ("250m" → 0.25, "500n" → 5e-7, "2" → 2). */
export function cpuToCores(v?: string): number {
  if (!v) return 0
  if (v.endsWith('n')) return parseFloat(v) / 1e9
  if (v.endsWith('u')) return parseFloat(v) / 1e6
  if (v.endsWith('m')) return parseFloat(v) / 1e3
  return parseFloat(v) || 0
}

const MEM_UNITS: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12
}
/** Memory quantity → bytes ("1Gi" → 2^30, "512Mi" → …, bare number passthrough). */
export function memoryToBytes(v?: string): number {
  if (!v) return 0
  const m = /^(\d+(?:\.\d+)?)([A-Za-z]+)?$/.exec(v)
  if (!m) return parseFloat(v) || 0
  const n = parseFloat(m[1])
  return m[2] ? n * (MEM_UNITS[m[2]] ?? 1) : n
}
export const fmtGi = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)}Gi`
export const fmtGiB = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)}GiB`
export const trimFixed = (n: number, digits: number): string => {
  const fixed = n.toFixed(digits)
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}
export const fmtCpuQuantity = (cores: number): string => {
  if (!cores) return '0'
  if (cores < 1) return `${trimFixed(cores * 1000, 1)}m`
  return trimFixed(cores, 2)
}
export const fmtByteQuantity = (bytes: number): string => {
  if (!bytes) return '0'
  if (bytes < 1024 ** 2) return `${trimFixed(bytes / 1024, 1)}KiB`
  if (bytes < 1024 ** 3) return `${trimFixed(bytes / 1024 ** 2, 1)}MiB`
  return fmtGiB(bytes)
}

export function ageOf(ts?: Date | string): string {
  if (!ts) return ''
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000))
  const d = Math.floor(s / 86400)
  if (d) return `${d}d`
  const h = Math.floor(s / 3600)
  if (h) return `${h}h`
  const m = Math.floor(s / 60)
  if (m) return `${m}m`
  return `${s}s`
}

/** CPU quantity -> millicores ("500m" -> 500, "1" -> 1000). */
export function cpuToMillicores(q: string): number {
  if (q.endsWith('m')) return parseInt(q, 10) || 0
  const n = parseFloat(q)
  return Number.isFinite(n) ? Math.round(n * 1000) : 0
}

const LIMIT_MEM_UNITS: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15
}
/** Memory quantity -> bytes ("1Gi" -> 2^30, "512Mi" -> ...), rounded. */
export function memoryToRoundedBytes(q: string): number {
  const m = /^(\d+(?:\.\d+)?)([A-Za-z]+)?$/.exec(q.trim())
  if (!m) return 0
  return Math.round(parseFloat(m[1]) * (m[2] ? (LIMIT_MEM_UNITS[m[2]] ?? 1) : 1))
}
export const formatCpu = (milli: number): string =>
  milli % 1000 === 0 ? `${milli / 1000}` : `${milli}m`
export const formatMem = (bytes: number): string => {
  const gi = 1024 ** 3
  if (bytes >= gi) {
    const v = bytes / gi
    return `${Number.isInteger(v) ? v : v.toFixed(1)}Gi`
  }
  return `${Math.round(bytes / 1024 ** 2)}Mi`
}
