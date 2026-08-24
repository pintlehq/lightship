import { ElectronAPI } from '@electron-toolkit/preload'

import type { LightshipApi } from '../shared/ipc-types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: LightshipApi
  }
}
