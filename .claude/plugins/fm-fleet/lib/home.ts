// Where the fleet's home is, and where the one command the mod runs lives.
//
// docs/configuration.md owns the resolution: the home is FM_HOME, then FM_ROOT_OVERRIDE, then the
// tracked code root, which for a mod is the Firstmate checkout the session runs in. This module
// only orders the candidates; the mods API answers which of them exist, so register.ts does the
// probing and keeps every `$` call in one file.
import { SNAPSHOT_SCRIPT } from './snapshot'

export type HomeEnv = {
  fmHome: string | undefined
  fmRootOverride: string | undefined
}

export type SessionDirs = {
  root: string | undefined
}

function named(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value
}

export function joinPath(directory: string, name: string): string {
  return directory.endsWith('/') ? `${directory}${name}` : `${directory}/${name}`
}

/** The directories that may hold the snapshot command, best first, each listed once. */
export function codeRootCandidates(env: HomeEnv, dirs: SessionDirs): string[] {
  const all = [dirs.root, named(env.fmRootOverride), named(env.fmHome)]
  const out: string[] = []
  for (const directory of all) {
    if (directory !== undefined && directory !== '' && !out.includes(directory)) out.push(directory)
  }
  return out
}

/** The path of the snapshot command under a code root. */
export function snapshotPathIn(codeRoot: string): string {
  return joinPath(codeRoot, SNAPSHOT_SCRIPT)
}

/** The effective home: FM_HOME, else FM_ROOT_OVERRIDE, else the code root the session runs in. */
export function homeOf(env: HomeEnv, codeRoot: string): string {
  return named(env.fmHome) ?? named(env.fmRootOverride) ?? codeRoot
}

/** What a home must hold besides the code: the runtime records a bare checkout has never made. */
export const HOME_MARKER = 'state'
