import { shell, type IpcMainInvokeEvent, type WebContents } from 'electron'

const appDocuments = new Map<WebContents, string>()

/** Only windows created by Lightship may call privileged IPC handlers. */
export function registerAppContents(contents: WebContents, documentUrl: string): void {
  appDocuments.set(contents, documentUrl)
  contents.once('destroyed', () => appDocuments.delete(contents))
}

export function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const contents = event.sender
  const documentUrl = appDocuments.get(contents)
  const frame = event.senderFrame
  if (
    !documentUrl ||
    contents.isDestroyed() ||
    !frame ||
    frame !== contents.mainFrame ||
    frame.url !== documentUrl ||
    contents.getURL() !== documentUrl
  ) {
    throw new Error('Untrusted renderer frame')
  }
}

/** The app has no document navigation; reloading its exact main document is allowed. */
export function isAllowedAppNavigation(
  destination: string,
  documentUrl: string,
  isMainFrame: boolean
): boolean {
  return isMainFrame && destination === documentUrl
}

/** The only links the app intentionally opens in the system browser. */
export function approvedExternalUrl(raw: string): string {
  if (raw !== raw.trim()) throw new Error('Refusing to open unapproved URL')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Refusing to open unapproved URL')
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Refusing to open unapproved URL')
  }

  if (url.protocol === 'https:' && url.hostname === 'www.pintle.app' && !url.port) {
    return url.href
  }

  // URL normalizes IP aliases such as 127.1. Check the literal authority too.
  const local = /^http:\/\/(localhost|127\.0\.0\.1):([0-9]{1,5})\/?$/.exec(raw)
  if (
    local &&
    url.protocol === 'http:' &&
    url.hostname === local[1] &&
    Number(local[2]) >= 1 &&
    Number(local[2]) <= 65535
  ) {
    return url.href
  }
  throw new Error('Refusing to open unapproved URL')
}

export function configureAppWindow(contents: WebContents, documentUrl: string): void {
  registerAppContents(contents, documentUrl)
  contents.on('will-frame-navigate', (event) => {
    if (!isAllowedAppNavigation(event.url, documentUrl, event.isMainFrame)) {
      event.preventDefault()
    }
  })
  contents.on('will-redirect', (event) => {
    if (!isAllowedAppNavigation(event.url, documentUrl, event.isMainFrame)) {
      event.preventDefault()
    }
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler((details) => {
    try {
      const url = approvedExternalUrl(details.url)
      void shell.openExternal(url).catch((error: unknown) => {
        console.error('Failed to open external URL', error)
      })
    } catch {
      // Unapproved destinations never reach the system browser.
    }
    return { action: 'deny' }
  })
}
