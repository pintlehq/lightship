import { toast } from '@renderer/ui/components/toaster'
import { errMsg } from './errors'

export function openExternal(url: string): void {
  const api = window.api?.window
  if (!api) {
    toast.error('Could not open browser', 'Desktop app required')
    return
  }
  void api.openExternal(url).catch((error: unknown) => {
    toast.error('Could not open browser', errMsg(error))
  })
}
