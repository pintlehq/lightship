import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

/**
 * Installs a custom application menu. The only non-default item is **Close**
 * (⌘W / Ctrl+W): instead of the native `close` role it notifies the focused
 * renderer (`shortcut:close-tab`), which closes the active tab and only closes
 * the window once no tabs remain. All other shortcuts (quit, copy/paste,
 * reload, devtools, minimize/zoom) are preserved via standard roles.
 */
export function buildAppMenu(): void {
  const isMac = process.platform === 'darwin'

  const closeItem: MenuItemConstructorOptions = {
    label: 'Close',
    accelerator: 'CmdOrCtrl+W',
    click: () => BrowserWindow.getFocusedWindow()?.webContents.send('shortcut:close-tab')
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: [closeItem, ...(isMac ? [] : [{ role: 'quit' as const }])] },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : [])
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
