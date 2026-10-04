// Which user-role rows are Firstmate's own operational inputs, so Calm can leave them undrawn.
//
// bin/fm-operational-input.sh owns the protocol: every current input starts with U+2063
// INVISIBLE SEPARATOR then "FIRSTMATE_OP: " (a permanent compatibility prefix, whatever version
// or kind follows it), the established from-firstmate carrier is "[fm-from-firstmate]" then
// U+2063, and the legacy away-supervisor escalation starts with U+2063 then "Supervisor escalate (".
// Recognising the three leading markers, rather than listing kinds, keeps a new kind hidden
// without a change here. tests/fm-calm-claude-mod.test.sh feeds this module the script's own
// output for every kind it constructs, so the two cannot drift unnoticed.
//
// The Pi extension requires the invisible separator before it asks the script, and the legacy
// session-start, watcher, and turn-end texts never carry it, so those stay visible here too.

const OPERATIONAL_MARK = '⁣'

const OPERATIONAL_PREFIXES = [
  `${OPERATIONAL_MARK}FIRSTMATE_OP: `,
  `[fm-from-firstmate]${OPERATIONAL_MARK}`,
  `${OPERATIONAL_MARK}Supervisor escalate (`,
] as const

export function isFirstmateOperationalInput(text: string): boolean {
  if (!text.includes(OPERATIONAL_MARK)) return false
  return OPERATIONAL_PREFIXES.some(
    (prefix) => text.startsWith(prefix) && text.length > prefix.length,
  )
}
