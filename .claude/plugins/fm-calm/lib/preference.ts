// The persisted Calm preference and the /calm command words, as pure functions.
//
// docs/configuration.md "Calm preference" owns the file contract this module implements: the
// same config/calm file under the effective Firstmate home that the Pi /calm command reads and
// writes. Every call that touches the file system or the environment lives in register.ts,
// because the mods API cannot be handed to another module.

export const CALM_PREFERENCE_FILE = 'calm'

/** The file that marks a directory as a Firstmate checkout when no home is named. */
export const FIRSTMATE_CHECKOUT_MARKER = 'bin/fm-session-start.sh'

/**
 * "max" is the legacy value written by a removed third presentation level, whose behavior is
 * now ordinary Calm; a home upgraded from it stays on. Absent, unreadable, or unrecognized
 * values read as off.
 */
export function parseCalmPreference(text: string): boolean {
  const stored = text.trim()
  return stored === 'on' || stored === 'max'
}

export function serializeCalmPreference(active: boolean): string {
  return active ? 'on\n' : 'off\n'
}

export type CalmCommand = 'toggle' | 'on' | 'off' | 'status'

/** `/calm` toggles; `/calm on`, `/calm off`, and `/calm status` are explicit. Anything else is unknown. */
export function parseCalmCommand(args: string): CalmCommand | undefined {
  const word = args.trim().toLowerCase()
  if (word === '') return 'toggle'
  if (word === 'on' || word === 'off' || word === 'status') return word
  return undefined
}

export function joinPath(base: string, ...parts: string[]): string {
  const stripped = base.replace(/\/+$/, '')
  return [stripped, ...parts].join('/')
}

export type CalmHomeInputs = {
  fmHome: string | undefined
  fmRootOverride: string | undefined
  fmConfigOverride: string | undefined
  /** The session's own checkout, when it is a Firstmate checkout: the "tracked code root". */
  checkoutRoot: string | undefined
}

const filled = (value: string | undefined): string | undefined =>
  value === undefined || value === '' ? undefined : value

/**
 * The preference file: FM_CONFIG_OVERRIDE when present, otherwise config/calm under FM_HOME,
 * then FM_ROOT_OVERRIDE, then the Firstmate checkout the session runs in. Undefined when none
 * of them names a home, so a session in an unrelated project never writes into it.
 */
export function calmPreferencePathOf(inputs: CalmHomeInputs): string | undefined {
  const configOverride = filled(inputs.fmConfigOverride)
  if (configOverride !== undefined) return joinPath(configOverride, CALM_PREFERENCE_FILE)
  const home =
    filled(inputs.fmHome) ?? filled(inputs.fmRootOverride) ?? filled(inputs.checkoutRoot)
  if (home === undefined) return undefined
  return joinPath(home, 'config', CALM_PREFERENCE_FILE)
}

/** A sibling of the preference file, so the final rename never crosses a file system. */
export function temporaryPathOf(path: string, nonce: string): string {
  return `${path}.${nonce}.tmp`
}

/**
 * One short line for a failed save. The engine words a refused call as "<plugin>: $.<call>: <why>",
 * and only the why helps someone reading a one-line reply.
 */
export function failureReasonOf(message: string): string {
  const line = message.trim().split('\n')[0] ?? ''
  const why = line.replace(/^[\w.-]+: \$\.[\w.]+: /, '')
  return why === '' ? 'unknown error' : why.slice(0, 120)
}
