import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { prepareCliPath } from './cli-path'
import { configureAppWindow } from './electron-boundary'
import { registerLightshipIpc } from './ipc'
import { buildAppMenu } from './menu'

// The packaged smoke test must not touch the operator's normal profile.
const smokeUserData = process.env['LIGHTSHIP_SMOKE_USER_DATA']
if (smokeUserData) {
  app.setPath('userData', smokeUserData)
  app.setPath('sessionData', smokeUserData)
}

function createWindow(): void {
  const rendererFile = join(__dirname, '../renderer/index.html')
  const devUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  if (devUrl) {
    const url = new URL(devUrl)
    if (
      url.protocol !== 'http:' ||
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.username ||
      url.password
    ) {
      throw new Error('Development renderer must use a local HTTP URL')
    }
  }
  const documentUrl = devUrl ? new URL(devUrl).href : pathToFileURL(rendererFile).href
  const mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Lightship',
    ...(process.platform === 'linux' ? { icon } : {}),
    // Frameless: hide the native title bar but keep the real macOS traffic
    // lights, positioned to sit inside the 36px custom titlebar.
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 11 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  configureAppWindow(mainWindow.webContents, documentUrl)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // HMR for renderer based on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (devUrl) {
    void mainWindow.loadURL(documentUrl)
  } else {
    void mainWindow.loadFile(rendererFile)
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    prepareCliPath()

    // Set app user model id for windows
    electronApp.setAppUserModelId('app.pintle.lightship')

    buildAppMenu()
    registerLightshipIpc()

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
