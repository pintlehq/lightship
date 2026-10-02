import { join } from 'node:path'
import { preparePtyHelpers } from './prepare-pty.mjs'

/**
 * electron-builder calls afterPack before signing, so permission changes are
 * included in the signed app and never require modifying an installed bundle.
 * @param {{ electronPlatformName: string, appOutDir: string, packager: {
 *   getResourcesDir: (appOutDir: string) => string
 * } }} context
 */
export default function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const packageRoot = join(
    context.packager.getResourcesDir(context.appOutDir),
    'app.asar.unpacked',
    'node_modules',
    'node-pty'
  )
  preparePtyHelpers(packageRoot, context.electronPlatformName)
}
