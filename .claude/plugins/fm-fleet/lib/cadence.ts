// When the fleet is read again. One timer ticks once a minute for the life of the session; this
// module says which ticks, and which turn ends, start a read. docs/fleet-mod.md owns the contract.

/** The shortest gap between two reads that start by themselves (a turn ending, a tick). */
export const MIN_GAP_MS = 30_000
/** The timer's period, and the read interval while the pane is open or a read has failed. */
export const TICK_MS = 60_000
/** The read interval while only the band is showing. */
export const BAND_ONLY_MS = 300_000
/** How long a read may take before it is given up as failed. */
export const READ_TIMEOUT_MS = 45_000

// A timer that fires a few milliseconds early must not push its read a whole period back.
const SLACK_MS = 5_000

/** True when a read that starts by itself at `now` keeps the minimum gap after the last one. */
export function isGapKept(now: number, lastStartedAt: number): boolean {
  return lastStartedAt === 0 || now - lastStartedAt >= MIN_GAP_MS
}

/** True when a tick at `now` is due a read: every minute while the pane is open or a read has failed, else every five. */
export function isTickDue(
  now: number,
  lastStartedAt: number,
  state: { isPaneOpen: boolean; isFailing: boolean },
): boolean {
  if (lastStartedAt === 0) return true
  const interval = state.isPaneOpen || state.isFailing ? TICK_MS : BAND_ONLY_MS
  return now - lastStartedAt >= interval - SLACK_MS
}
