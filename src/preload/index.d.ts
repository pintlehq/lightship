import type { LightshipApi } from '../shared/ipc-types'

declare global {
  interface Window {
    api: LightshipApi
  }
}
