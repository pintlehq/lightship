import { existsSync } from 'node:fs'

const MAC_CLI_DIRS = ['/opt/homebrew/bin', '/usr/local/bin']
const MAC_SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

/** GUI-launched macOS apps may not inherit the shell path used by kubeconfig exec helpers. */
export function prepareCliPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync
): void {
  if (platform !== 'darwin') return

  const entries = (env.PATH || MAC_SYSTEM_PATH).split(':').filter(Boolean)
  for (const directory of MAC_CLI_DIRS) {
    if (exists(directory) && !entries.includes(directory)) entries.push(directory)
  }
  env.PATH = entries.join(':')
}
