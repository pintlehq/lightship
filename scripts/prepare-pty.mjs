import fs from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const nativeDirectories = [
  'build/Release',
  'build/Debug',
  'prebuilds/darwin-arm64',
  'prebuilds/darwin-x64'
]

/**
 * node-pty 1.1.0 ships macOS helpers without execute permission. Repair during
 * setup/packaging, never at runtime inside a signed application.
 * @param {string} packageRoot
 * @param {string} platform
 * @returns {string[]} The verified helper paths.
 */
export function preparePtyHelpers(packageRoot, platform = process.platform) {
  if (platform !== 'darwin') return []

  const helpers = []
  for (const directory of nativeDirectories) {
    const nativePath = join(packageRoot, directory, 'pty.node')
    const helperPath = join(packageRoot, directory, 'spawn-helper')
    if (!fs.existsSync(nativePath) && !fs.existsSync(helperPath)) continue

    try {
      const stat = fs.statSync(helperPath)
      if (!stat.isFile()) throw new Error('expected a regular spawn-helper file')
      if ((stat.mode & 0o777) !== 0o755) fs.chmodSync(helperPath, 0o755)
      fs.accessSync(helperPath, fs.constants.X_OK)
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      throw new Error(`Cannot prepare node-pty helper at ${helperPath}: ${detail}`, { cause })
    }
    helpers.push(helperPath)
  }

  if (helpers.length === 0) {
    throw new Error(
      `No macOS node-pty spawn-helper found under ${packageRoot}. Reinstall dependencies.`
    )
  }
  return helpers
}

export function prepareInstalledPty() {
  if (process.platform !== 'darwin') return []
  const require = createRequire(import.meta.url)
  return preparePtyHelpers(dirname(require.resolve('node-pty/package.json')))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const helpers = prepareInstalledPty()
    if (helpers.length) console.log(`Verified ${helpers.length} executable node-pty helpers`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
