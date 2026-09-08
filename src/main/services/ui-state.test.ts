import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// UI state persists a small JSON file under lightship-data/configs. Route Electron's
// `app.getPath` to a throwaway temp dir so the service writes to disk in tests.
// No safeStorage stub — this state is non-sensitive.
const env = vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs')
  const os = require('node:os') as typeof import('node:os')
  const path = require('node:path') as typeof import('node:path')
  return { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'lightship-uis-')) }
})

vi.mock('electron', () => ({ app: { getPath: () => env.dir } }))

// Imported after vi.mock so its top-level `from 'electron'` binds the stub.
import * as uiState from './ui-state'

const lightshipDataDir = join(env.dir, 'lightship-data')
const configsDir = join(lightshipDataDir, 'configs')
const stateFile = join(configsDir, 'preferences.json')
const previousConfigsDir = join(env.dir, 'configs')

beforeEach(() => {
  rmSync(lightshipDataDir, { recursive: true, force: true })
  rmSync(previousConfigsDir, { recursive: true, force: true })
})

afterAll(() => rmSync(env.dir, { recursive: true, force: true }))

describe('ui-state', () => {
  it('round-trips setDetailTab → readUiState and overwrites on repeat', async () => {
    await uiState.setDetailTab('c1|deployments|prod|api', 'logs')
    expect((await uiState.readUiState()).detailTabs).toEqual({
      'c1|deployments|prod|api': 'logs'
    })

    await uiState.setDetailTab('c1|deployments|prod|api', 'yaml')
    expect((await uiState.readUiState()).detailTabs['c1|deployments|prod|api']).toBe('yaml')
  })

  it('returns the empty default when no file exists', async () => {
    expect(await uiState.readUiState()).toEqual({ detailTabs: {} })
  })

  it('falls back to the empty default on a corrupt or wrong-shape file', async () => {
    mkdirSync(configsDir, { recursive: true })

    writeFileSync(stateFile, '{ not valid json', 'utf8')
    expect(await uiState.readUiState()).toEqual({ detailTabs: {} })

    writeFileSync(stateFile, JSON.stringify({ schemaVersion: 1, detailTabs: 'nope' }), 'utf8')
    expect(await uiState.readUiState()).toEqual({ detailTabs: {} })
  })

  it('caps the map at 500 entries, dropping the oldest', async () => {
    for (let i = 0; i < 540; i++) await uiState.setDetailTab(`k${i}`, 'overview')

    const { detailTabs } = await uiState.readUiState()
    expect(Object.keys(detailTabs)).toHaveLength(500)
    expect(detailTabs['k0']).toBeUndefined() // oldest dropped
    expect(detailTabs['k39']).toBeUndefined()
    expect(detailTabs['k40']).toBe('overview') // first surviving key
    expect(detailTabs['k539']).toBe('overview') // newest kept
  }, 20_000)

  it('writes a versioned preferences document', async () => {
    await uiState.setDetailTab('cluster|pods|default|api', 'logs')
    expect(JSON.parse(readFileSync(stateFile, 'utf8'))).toEqual({
      schemaVersion: 1,
      detailTabs: { 'cluster|pods|default|api': 'logs' }
    })
  })

  it('serializes concurrent preference updates', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_value, index) =>
        uiState.setDetailTab(`cluster|pods|default|pod-${index}`, 'logs')
      )
    )
    expect(Object.keys((await uiState.readUiState()).detailTabs)).toHaveLength(20)
  })

  it('uses private POSIX permissions', async () => {
    if (process.platform === 'win32') return
    await uiState.setDetailTab('cluster|pods|default|api', 'logs')

    expect(statSync(configsDir).mode & 0o777).toBe(0o700)
    expect(statSync(stateFile).mode & 0o777).toBe(0o600)
  })

  it('ignores and preserves the previous top-level configs directory', async () => {
    mkdirSync(previousConfigsDir, { recursive: true })
    const previousFile = join(previousConfigsDir, 'preferences.json')
    writeFileSync(
      previousFile,
      JSON.stringify({ schemaVersion: 1, detailTabs: { previous: 'logs' } }),
      'utf8'
    )

    expect(await uiState.readUiState()).toEqual({ detailTabs: {} })
    await uiState.setDetailTab('fresh', 'overview')
    expect(readFileSync(previousFile, 'utf8')).toContain('previous')
  })
})
