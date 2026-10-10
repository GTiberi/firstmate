// The words /fleet takes, and the one line it prints for a word it does not know.
export type FleetCommand = 'open' | 'close' | 'refresh' | 'status'

export const USAGE = 'Usage: /fleet [close|refresh|status]'

/** The command an argument string names; undefined for a word /fleet does not take. */
export function parseFleetCommand(args: string): FleetCommand | undefined {
  switch (args.trim().toLowerCase()) {
    case '':
      return 'open'
    case 'close':
      return 'close'
    case 'refresh':
      return 'refresh'
    case 'status':
      return 'status'
    default:
      return undefined
  }
}

/** Why a read failed, in one short line the band can carry. */
export function failureReasonOf(message: string): string {
  const firstLine = message.split('\n').find((line) => line.trim() !== '') ?? ''
  const flat = firstLine.replace(/\s+/g, ' ').trim()
  return flat === '' ? 'no reason given' : flat.length > 80 ? `${flat.slice(0, 79)}…` : flat
}

/** Why the snapshot command could not be run or finished, without the engine's own wording. */
export function startFailureReason(message: string, timeoutSeconds: number): string {
  if (/time(d)? ?out|still running/i.test(message)) return `the snapshot took longer than ${timeoutSeconds} seconds`
  if (/EACCES|EPERM|permission denied/i.test(message)) return 'the snapshot command is not runnable: permission denied'
  if (/ENOENT|no such file|not found/i.test(message)) return 'the snapshot command was not found'
  return 'the snapshot command could not be run'
}
