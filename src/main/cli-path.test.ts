import { describe, expect, it } from 'vitest'

import { prepareCliPath } from './cli-path'

const homebrewExists = (path: string): boolean =>
  path === '/opt/homebrew/bin' || path === '/usr/local/bin'

describe('prepareCliPath', () => {
  it('adds existing Homebrew directories after a minimal macOS app path', () => {
    const env = { PATH: '/usr/bin:/bin' }

    prepareCliPath(env, 'darwin', homebrewExists)

    expect(env.PATH).toBe('/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin')
  })

  it('keeps existing path order without duplicating a Homebrew directory', () => {
    const env = { PATH: '/opt/homebrew/bin:/custom/bin:/usr/bin' }

    prepareCliPath(env, 'darwin', homebrewExists)

    expect(env.PATH).toBe('/opt/homebrew/bin:/custom/bin:/usr/bin:/usr/local/bin')
  })

  it('leaves non-macOS paths unchanged', () => {
    const env = { PATH: '/usr/bin:/bin' }

    prepareCliPath(env, 'linux', homebrewExists)

    expect(env.PATH).toBe('/usr/bin:/bin')
  })

  it('uses the macOS system path if PATH is missing and skips unavailable directories', () => {
    const env: NodeJS.ProcessEnv = {}

    prepareCliPath(env, 'darwin', (path) => path === '/opt/homebrew/bin')

    expect(env.PATH).toBe('/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin')
  })
})
