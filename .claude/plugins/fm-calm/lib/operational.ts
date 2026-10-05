// Which user-role rows are Firstmate's own operational inputs, so Calm can leave them undrawn.
//
// bin/fm-operational-input.sh owns the protocol: every current input is U+2063 INVISIBLE SEPARATOR
// then "FIRSTMATE_OP: v1 <kind>: <body>", the established from-firstmate carrier is
// "[fm-from-firstmate]" then U+2063 then the body, and the legacy untyped and away-supervisor
// forms start with U+2063 then "FIRSTMATE_OP: " and "Supervisor escalate (".
//
// Claude Code drops U+2063 from everything typed or pasted into its composer, which is how
// Firstmate delivers an input to a Claude pane, so the row the mod is handed reads
// "FIRSTMATE_OP: v1 <kind>: <body>" with the separator already gone. The header is therefore
// matched with or without it. Matching "v<digits> <kind-word>:" rather than a list of kinds
// keeps a new kind or version hidden without a change here; the forms that were never typed
// (untyped legacy, away-supervisor legacy) are matched only with the separator that proves them.
// tests/fm-calm-claude-mod.test.sh feeds this module the script's own output for every kind it
// constructs, so the two cannot drift unnoticed.
//
// The Pi extension requires the separator before it asks the script, and the legacy
// session-start, watcher, and turn-end texts never carry it, so those stay visible here too.

const OPERATIONAL_MARK = '\u2063'

const TYPED_HEADER = /^FIRSTMATE_OP: v\d+ [a-z][a-z0-9-]*: [\s\S]/
const UNTYPED_PREFIX = 'FIRSTMATE_OP: '
const FROM_FIRSTMATE_LABEL = '[fm-from-firstmate]'
const LEGACY_AWAY_PREFIX = 'Supervisor escalate ('

export function isFirstmateOperationalInput(text: string): boolean {
  const hasMark = text.startsWith(OPERATIONAL_MARK)
  const bare = hasMark ? text.slice(OPERATIONAL_MARK.length) : text

  if (TYPED_HEADER.test(bare)) return true

  if (bare.startsWith(FROM_FIRSTMATE_LABEL)) {
    const rest = bare.slice(FROM_FIRSTMATE_LABEL.length)
    const body = rest.startsWith(OPERATIONAL_MARK) ? rest.slice(OPERATIONAL_MARK.length) : rest
    return body.length > 0
  }

  if (!hasMark) return false
  if (bare.startsWith(UNTYPED_PREFIX)) return bare.length > UNTYPED_PREFIX.length
  return bare.startsWith(LEGACY_AWAY_PREFIX)
}
