import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import afterPack from './after-pack.mjs'
import { preparePtyHelpers } from './prepare-pty.mjs'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'lightship-pty-prepare-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

function fixture(directory: string, mode = 0o644, packageRoot = root): string {
  const helper = join(packageRoot, directory, 'spawn-helper')
  fs.mkdirSync(dirname(helper), { recursive: true })
  fs.writeFileSync(join(dirname(helper), 'pty.node'), '')
  fs.writeFileSync(helper, '')
  fs.chmodSync(helper, mode)
  return helper
}

it
  .skipIf(process.platform === 'win32')
  .each(['prebuilds/darwin-arm64', 'prebuilds/darwin-x64', 'build/Release', 'build/Debug'])(
  'repairs execute permissions in %s',
  (directory) => {
    const helper = fixture(directory)

    expect(preparePtyHelpers(root, 'darwin')).toEqual([helper])
    expect(fs.statSync(helper).mode & 0o777).toBe(0o755)
    fs.accessSync(helper, fs.constants.X_OK)
  }
)

it.skipIf(process.platform === 'win32')(
  'repairs all shipped architectures and is repeatable',
  () => {
    const arm = fixture('prebuilds/darwin-arm64')
    const x64 = fixture('prebuilds/darwin-x64', 0o755)
    const chmod = vi.spyOn(fs, 'chmodSync')

    expect(preparePtyHelpers(root, 'darwin')).toEqual([arm, x64])
    expect(chmod).toHaveBeenCalledExactlyOnceWith(arm, 0o755)
    chmod.mockClear()
    expect(preparePtyHelpers(root, 'darwin')).toEqual([arm, x64])
    expect(chmod).not.toHaveBeenCalled()
  }
)

it('reports missing helpers rather than silently succeeding', () => {
  expect(() => preparePtyHelpers(root, 'darwin')).toThrow(
    `No macOS node-pty spawn-helper found under ${root}`
  )
})

it('fails when a native module is missing its helper even if another layout is valid', () => {
  fixture('prebuilds/darwin-x64')
  const missing = fixture('build/Release')
  fs.unlinkSync(missing)

  expect(() => preparePtyHelpers(root, 'darwin')).toThrow(missing)
})

it('reports the helper path and cause when permissions cannot be repaired', () => {
  const helper = fixture('prebuilds/darwin-arm64')
  vi.spyOn(fs, 'chmodSync').mockImplementation(() => {
    throw new Error('EACCES: permission denied')
  })

  expect(() => preparePtyHelpers(root, 'darwin')).toThrow(
    `Cannot prepare node-pty helper at ${helper}: EACCES: permission denied`
  )
})

it.each(['linux', 'win32'])('does not inspect or change helpers on %s', (platform) => {
  const stat = vi.spyOn(fs, 'statSync')
  const chmod = vi.spyOn(fs, 'chmodSync')

  expect(preparePtyHelpers(join(root, 'missing'), platform)).toEqual([])
  expect(stat).not.toHaveBeenCalled()
  expect(chmod).not.toHaveBeenCalled()
})

it.skipIf(process.platform === 'win32')('prepares the unpacked copy in the staged app', () => {
  const resources = join(root, 'Custom Name.app', 'Contents', 'Resources')
  const packageRoot = join(resources, 'app.asar.unpacked', 'node_modules', 'node-pty')
  const helper = fixture('prebuilds/darwin-arm64', 0o644, packageRoot)
  const getResourcesDir = vi.fn().mockReturnValue(resources)

  afterPack({ electronPlatformName: 'darwin', appOutDir: root, packager: { getResourcesDir } })

  expect(getResourcesDir).toHaveBeenCalledWith(root)
  expect(fs.statSync(helper).mode & 0o777).toBe(0o755)
})

it('rejects a packaged app without an unpacked helper', () => {
  expect(() =>
    afterPack({
      electronPlatformName: 'darwin',
      appOutDir: root,
      packager: { getResourcesDir: () => root }
    })
  ).toThrow('No macOS node-pty spawn-helper')
})

it.each(['linux', 'win32'])('skips packaged helper checks for %s targets', (platform) => {
  const getResourcesDir = vi.fn()
  afterPack({ electronPlatformName: platform, appOutDir: root, packager: { getResourcesDir } })
  expect(getResourcesDir).not.toHaveBeenCalled()
})
