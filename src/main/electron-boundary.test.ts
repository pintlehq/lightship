import { EventEmitter } from 'node:events'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ openExternal: vi.fn() }))
vi.mock('electron', () => ({ shell: { openExternal: electron.openExternal } }))

import { approvedExternalUrl, assertTrustedSender, configureAppWindow } from './electron-boundary'

const documentUrl = 'file:///app/renderer/index.html'

class FakeContents extends EventEmitter {
  mainFrame = { url: documentUrl }
  destroyed = false
  currentUrl = documentUrl
  openHandler: ((details: { url: string }) => { action: string }) | undefined
  isDestroyed = (): boolean => this.destroyed
  getURL = (): string => this.currentUrl
  setWindowOpenHandler = vi.fn((handler: (details: { url: string }) => { action: string }) => {
    this.openHandler = handler
  })
  close(): void {
    this.destroyed = true
    this.emit('destroyed')
  }
}

beforeEach(() => {
  electron.openExternal.mockReset().mockResolvedValue(undefined)
})

describe('external URL policy', () => {
  it.each(['https://www.pintle.app', 'https://www.pintle.app/'])('allows %s', (raw) => {
    expect(approvedExternalUrl(raw)).toBe('https://www.pintle.app/')
  })

  it.each(['http://localhost:43821', 'http://127.0.0.1:80/'])(
    'allows a literal loopback forward %s',
    (raw) => {
      expect(approvedExternalUrl(raw)).toMatch(/^http:\/\/(localhost|127\.0\.0\.1)/)
    }
  )

  it.each([
    'http://localhost:80@example.org',
    'http://user@localhost:43821',
    'http://127.1:43821',
    'http://localhost.:43821',
    'http://localhost:43821/path',
    'http://localhost:43821?next=https://evil.test',
    'http://localhost:0',
    'http://localhost:65536',
    'http://localhost',
    'https://www.pintle.app.evil.test',
    'https://user@www.pintle.app',
    'https://www.pintle.app:444/',
    'https://www.pintle.app/redirect',
    'http://www.pintle.app',
    'file:///etc/passwd',
    'javascript:alert(1)',
    ' https://www.pintle.app/'
  ])('rejects %s', (raw) => {
    expect(() => approvedExternalUrl(raw)).toThrow('Refusing to open unapproved URL')
  })
})

describe('app window boundary', () => {
  it('trusts only its current main document and unregisters on destruction', () => {
    const contents = new FakeContents()
    configureAppWindow(contents as unknown as WebContents, documentUrl)
    const event = { sender: contents, senderFrame: contents.mainFrame }
    expect(() => assertTrustedSender(event as unknown as IpcMainInvokeEvent)).not.toThrow()
    expect(() =>
      assertTrustedSender({
        ...event,
        senderFrame: { url: documentUrl }
      } as unknown as IpcMainInvokeEvent)
    ).toThrow('Untrusted renderer frame')
    contents.currentUrl = 'https://evil.test/'
    expect(() => assertTrustedSender(event as unknown as IpcMainInvokeEvent)).toThrow(
      'Untrusted renderer frame'
    )
    contents.currentUrl = documentUrl
    contents.mainFrame.url = 'https://evil.test/'
    expect(() => assertTrustedSender(event as unknown as IpcMainInvokeEvent)).toThrow(
      'Untrusted renderer frame'
    )
    contents.mainFrame.url = documentUrl
    contents.close()
    expect(() => assertTrustedSender(event as unknown as IpcMainInvokeEvent)).toThrow(
      'Untrusted renderer frame'
    )
  })

  it('blocks off-app navigation, redirects, subframes, and webviews', () => {
    const contents = new FakeContents()
    configureAppWindow(contents as unknown as WebContents, documentUrl)
    for (const kind of ['will-frame-navigate', 'will-redirect']) {
      const allowed = { url: documentUrl, isMainFrame: true, preventDefault: vi.fn() }
      contents.emit(kind, allowed)
      expect(allowed.preventDefault).not.toHaveBeenCalled()
      for (const [url, isMainFrame] of [
        ['https://evil.test/', true],
        [documentUrl, false]
      ] as const) {
        const denied = { url, isMainFrame, preventDefault: vi.fn() }
        contents.emit(kind, denied)
        expect(denied.preventDefault).toHaveBeenCalledOnce()
      }
    }
    const webview = { preventDefault: vi.fn() }
    contents.emit('will-attach-webview', webview)
    expect(webview.preventDefault).toHaveBeenCalledOnce()
  })

  it('denies all Electron windows and opens only approved system-browser links', async () => {
    const contents = new FakeContents()
    configureAppWindow(contents as unknown as WebContents, documentUrl)
    expect(contents.openHandler?.({ url: 'https://www.pintle.app' })).toEqual({ action: 'deny' })
    expect(contents.openHandler?.({ url: 'http://localhost:43821' })).toEqual({ action: 'deny' })
    expect(contents.openHandler?.({ url: 'http://localhost:80@example.org' })).toEqual({
      action: 'deny'
    })
    await Promise.resolve()
    expect(electron.openExternal).toHaveBeenCalledTimes(2)
    expect(electron.openExternal).toHaveBeenCalledWith('https://www.pintle.app/')
    expect(electron.openExternal).toHaveBeenCalledWith('http://localhost:43821/')
  })

  it('observes a rejected system-browser open', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    electron.openExternal.mockRejectedValueOnce(new Error('browser unavailable'))
    const contents = new FakeContents()
    configureAppWindow(contents as unknown as WebContents, documentUrl)
    contents.openHandler?.({ url: 'https://www.pintle.app' })
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith('Failed to open external URL', expect.any(Error))
    )
    error.mockRestore()
  })
})
