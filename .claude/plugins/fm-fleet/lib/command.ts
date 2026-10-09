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
