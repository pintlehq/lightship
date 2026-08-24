import type { NodeRow, Pod } from '../types'

/** Small deterministic PRNG so generated datasets are stable across renders. */
function mulberry32(seed: number) {
  let s = seed
  return function () {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NAMESPACES = [
  'checkout',
  'payments',
  'search',
  'platform',
  'istio-system',
  'observability',
  'identity',
  'catalog',
  'default',
  'kube-system'
]

const APP_NAMES = [
  'checkout-api',
  'checkout-worker',
  'payments-gateway',
  'ledger-postgres',
  'search-indexer',
  'search-api',
  'redis-cache',
  'notifications-cron',
  'auth-service',
  'catalog-api',
  'cart-service',
  'recommendation',
  'fraud-scorer',
  'image-resizer',
  'webhook-dispatcher',
  'session-store',
  'metrics-agent',
  'log-forwarder',
  'config-reloader',
  'istio-proxy'
]

const STATUS_POOL: Array<[string, number]> = [
  ['Running', 0.82],
  ['Pending', 0.05],
  ['CrashLoopBackOff', 0.04],
  ['Completed', 0.045],
  ['Terminating', 0.02],
  ['Error', 0.025]
]

const AGES = ['38s', '2m', '12m', '38m', '1h', '6h', '14h', '2d', '4d', '9d', '14d', '21d', '60d']
const HEX = '0123456789abcdef'

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]
}

function suffix(rand: () => number, len: number): string {
  let out = ''
  for (let i = 0; i < len; i++) out += HEX[Math.floor(rand() * HEX.length)]
  return out
}

function weightedStatus(rand: () => number): string {
  const r = rand()
  let acc = 0
  for (const [status, weight] of STATUS_POOL) {
    acc += weight
    if (r <= acc) return status
  }
  return 'Running'
}

export function generatePods(count: number): Pod[] {
  const rand = mulberry32(0x50d5 + count)
  const nodeNames = generateNodeNames(rand, 60)
  const pods: Pod[] = []
  for (let i = 0; i < count; i++) {
    const app = pick(rand, APP_NAMES)
    const ns = pick(rand, NAMESPACES)
    const status = weightedStatus(rand)
    const containers = rand() > 0.6 ? 2 : 1
    const restarts =
      status === 'CrashLoopBackOff'
        ? 3 + Math.floor(rand() * 9)
        : rand() > 0.85
          ? 1 + Math.floor(rand() * 3)
          : 0
    const dead = status === 'Completed' || status === 'Pending' || status === 'Error'
    const ready = dead ? `0/${containers}` : `${containers}/${containers}`
    const cpu = dead ? '0m' : `${4 + Math.floor(rand() * 540)}m`
    const memMi = dead ? 0 : 48 + Math.floor(rand() * 2100)
    const mem = memMi > 1024 ? `${(memMi / 1024).toFixed(1)}Gi` : `${memMi}Mi`
    const node = dead && status === 'Pending' ? '—' : pick(rand, nodeNames)
    pods.push({
      name: `${app}-${suffix(rand, 9)}-${suffix(rand, 5)}`,
      ns,
      status,
      ready,
      restarts,
      cpu,
      mem,
      node,
      age: pick(rand, AGES),
      ip: node === '—' ? '—' : `10.2.${10 + Math.floor(rand() * 40)}.${Math.floor(rand() * 250)}`,
      containers: (containers === 2 ? ['app', 'istio-proxy'] : ['app']).map((cn) => ({
        name: cn,
        ready: !dead,
        state: dead ? status : 'Running'
      }))
    })
  }
  return pods
}

function generateNodeNames(rand: () => number, count: number): string[] {
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    names.push(`ip-10-2-${10 + Math.floor(rand() * 60)}-${Math.floor(rand() * 250)}`)
  }
  return names
}

const ZONES = ['euw1-a', 'euw1-b', 'euw1-c']
const INSTANCE_TYPES = [
  'm6i.large',
  'm6i.xlarge',
  'm6i.2xlarge',
  'c6i.large',
  'c6i.xlarge',
  'r6i.xlarge'
]

export function generateNodes(count: number): NodeRow[] {
  const rand = mulberry32(0x90de + count)
  const nodes: NodeRow[] = []
  for (let i = 0; i < count; i++) {
    const cp = rand() > 0.85
    const notReady = rand() > 0.92
    const cpuPct = Math.floor(10 + rand() * 88)
    const memPct = Math.floor(10 + rand() * 85)
    const pods = Math.floor(rand() * 28)
    nodes.push({
      name: `ip-10-2-${10 + Math.floor(rand() * 60)}-${Math.floor(rand() * 250)}`,
      roles: cp ? ['control-plane'] : ['worker'],
      status: notReady ? 'NotReady' : 'Ready',
      cpuPct,
      cpu: `${((cpuPct / 100) * 4).toFixed(1)} / 4`,
      memPct,
      mem: `${((memPct / 100) * 16).toFixed(1)} / 16Gi`,
      pods,
      maxPods: 29,
      ver: 'v1.29.4',
      zone: pick(rand, ZONES),
      type: cp ? 'c6i.large' : pick(rand, INSTANCE_TYPES),
      age: pick(rand, AGES),
      ip: `10.2.${10 + Math.floor(rand() * 60)}.${Math.floor(rand() * 250)}`,
      taint: notReady ? 'NoSchedule' : undefined,
      cordoned: rand() > 0.9
    })
  }
  return nodes
}
