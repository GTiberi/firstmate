#!/usr/bin/env bash
# Opt-in live guard for the Claude Code Calm mod (.claude/plugins/fm-calm).
#
# The mod's tests run against the engine, but three facts it stands on only show up in a real
# Claude Code terminal: the boat replaces the stock spinner at the full window width in the
# terminal's own palette, the hidden rows leave no blank rows behind, and Claude Code's composer
# drops the U+2063 that opens an operational input before the mod ever sees the row. This guard
# drives one short real session through tmux with a small model and fails naming the Claude Code
# version when any of them changes.
#
# It submits prompts, so it is opt-in:
#   FM_CALM_CLAUDE_LIVE_E2E=1 tests/fm-calm-claude-mod-live-e2e.test.sh
# The project directory and FM_HOME are throwaway; Claude keeps using its existing managed
# authentication, and no Firstmate home, checkout, or settings file is touched. Accepting the
# trust prompt for the throwaway directory is recorded by Claude Code like any other folder.
set -u

# shellcheck source=tests/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

fm_live_gate opt-in FM_CALM_CLAUDE_LIVE_E2E tmux claude

MIN_CLAUDE=2.1.287
COLUMNS_WIDE=100
ROWS=40
SOCKET="fm-calm-claude-live-$$"
SESSION=calm
PLUGIN="$ROOT/.claude/plugins/fm-calm"
REAL_TMUX=$(command -v tmux)

CLAUDE_VERSION=$(claude --version 2>/dev/null | sed -n 's/^\([0-9][0-9]*\(\.[0-9][0-9]*\)*\).*/\1/p' | head -n 1)
[ -n "$CLAUDE_VERSION" ] || fail "claude did not report a version"
if [ "$(printf '%s\n%s\n' "$MIN_CLAUDE" "$CLAUDE_VERSION" | sort -V | head -n 1)" != "$MIN_CLAUDE" ]; then
  echo "skip: live: claude $CLAUDE_VERSION is older than $MIN_CLAUDE, the first release with mods"
  exit 0
fi

TMP_ROOT=$(fm_test_tmproot fm-calm-claude-mod-live)
WORK="$TMP_ROOT/harbor"
LIVE_HOME="$TMP_ROOT/home"
mkdir -p "$WORK" "$LIVE_HOME/config"
printf 'anchor tide harbor\nsecond line\n' >"$WORK/notes.txt"

cleanup_all() {
  "$REAL_TMUX" -L "$SOCKET" kill-server >/dev/null 2>&1 || true
  fm_test_cleanup
}
trap cleanup_all EXIT

# The launcher keeps the quoting of PATH (which may hold spaces and parentheses) out of tmux's
# command string, and starts claude without the ambient CLAUDE_* markers of an enclosing session.
printf '#!/usr/bin/env bash\ncd %q || exit 1\nexec env -i HOME=%q PATH=%q TERM=xterm-256color LANG=C.UTF-8 FM_HOME=%q claude --plugin-dir %q --model haiku\n' \
  "$WORK" "$HOME" "$PATH" "$LIVE_HOME" "$PLUGIN" >"$TMP_ROOT/launch.sh"
chmod +x "$TMP_ROOT/launch.sh"

tm() {
  "$REAL_TMUX" -L "$SOCKET" "$@"
}
pane() {
  tm capture-pane -p -t "$SESSION"
}
pane_escapes() {
  tm capture-pane -p -e -t "$SESSION"
}

# wait_pane <polls of a quarter second> <fixed text> - true once the visible pane shows the text.
wait_pane() {
  local limit=$1 text=$2 tick=0
  while [ "$tick" -lt "$limit" ]; do
    pane | grep -Fq -- "$text" && return 0
    sleep 0.25
    tick=$((tick + 1))
  done
  return 1
}

# wait_pane_count <polls> <fixed text> <count> - true once the visible pane shows the text that
# many times, for a reply that an earlier command already printed once.
wait_pane_count() {
  local limit=$1 text=$2 want=$3 tick=0
  while [ "$tick" -lt "$limit" ]; do
    [ "$(pane | grep -cF -- "$text")" -ge "$want" ] && return 0
    sleep 0.25
    tick=$((tick + 1))
  done
  return 1
}

# Claude Code takes a paste burst for one input, so text and Enter go in separately.
say() {
  tm send-keys -t "$SESSION" -l "$1"
  sleep 1
  tm send-keys -t "$SESSION" Enter
}

# An input that opens with U+2063 needs the Enter pressed twice: the composer's first one lands
# while it is still removing the separator. A second Enter on an empty prompt does nothing.
say_with_separator() {
  tm send-keys -t "$SESSION" -l "$1"
  sleep 1
  tm send-keys -t "$SESSION" Enter
  sleep 3
  tm send-keys -t "$SESSION" Enter
}

preference() {
  tr -d '\n' <"$LIVE_HOME/config/calm" 2>/dev/null
}

# Column of the hull's backslash in a boat frame, or empty when the frame holds no boat.
hull_column() {
  pane | awk '/\\__\// { print index($0, "\\__/") - 1; exit }'
}

# The width of the boat's water row in the current frame, or empty when there is none.
water_width() {
  pane | awk '/\\__\// { print length($0); exit }'
}

tm new-session -d -s "$SESSION" -x "$COLUMNS_WIDE" -y "$ROWS" -c "$WORK" "$TMP_ROOT/launch.sh; sleep 600"

wait_pane 120 "Yes, I trust this folder" || fail "Claude Code $CLAUDE_VERSION did not show the folder trust prompt: $(pane)"
sleep 1
tm send-keys -t "$SESSION" Down
sleep 1
tm send-keys -t "$SESSION" Enter
wait_pane 120 "Claude Code v" || fail "Claude Code $CLAUDE_VERSION did not start after the trust prompt: $(pane)"
sleep 3

say "/calm status"
wait_pane 80 "fm-calm: Calm is off." || fail "Claude Code $CLAUDE_VERSION did not answer /calm status from the loaded mod: $(pane)"

say "/calm on"
wait_pane 80 "fm-calm: Calm is on." || fail "/calm on did not answer on Claude Code $CLAUDE_VERSION: $(pane)"
[ "$(preference)" = on ] || fail "/calm on wrote '$(preference)' to config/calm instead of on"

# One run with Calm on: poll its frames, keeping the distinct hull columns, every water width,
# and the escape codes of the first boat frame.
say "Use the Read tool on notes.txt five times, one call per step, then reply with only its first word."
columns_seen=()
widths_seen=()
escapes=''
polls=0
while [ "$polls" -lt 400 ]; do
  column=$(hull_column)
  if [ -n "$column" ]; then
    case " ${columns_seen[*]:-} " in *" $column "*) ;; *) columns_seen+=("$column") ;; esac
    widths_seen+=("$(water_width)")
    [ -n "$escapes" ] || escapes=$(pane_escapes | grep -F '__/' | head -n 1)
  fi
  pane | grep -Fq '● anchor' && break
  sleep 0.2
  polls=$((polls + 1))
done
pane | grep -Fq '● anchor' || fail "Claude Code $CLAUDE_VERSION never answered the Calm-on run: $(pane)"
[ "${#columns_seen[@]}" -ge 1 ] || fail "Claude Code $CLAUDE_VERSION drew no boat during a Calm-on run: the spinner site may have moved"
[ "${#columns_seen[@]}" -ge 2 ] \
  || fail "the boat never moved on Claude Code $CLAUDE_VERSION; hull columns seen: ${columns_seen[*]}"
for width in "${widths_seen[@]}"; do
  [ "$width" = "$COLUMNS_WIDE" ] || fail "the boat's water row was $width columns wide, not the window's $COLUMNS_WIDE, on Claude Code $CLAUDE_VERSION"
done
# 38;5;3 and 38;5;4 are palette entries 3 and 4 of the terminal's own table: standard yellow and
# blue. A named colour would come out as Claude Code's theme colour instead.
case "$escapes" in
  *'38;5;3m'*'38;5;4m'*) ;;
  *) fail "the boat is not drawn in palette entries 3 and 4 on Claude Code $CLAUDE_VERSION: $escapes" ;;
esac

# Settled: the tool row is hidden and leaves no row behind, and no boat is left on screen.
sleep 2
settled=$(pane)
printf '%s\n' "$settled" | grep -Eq 'Read [0-9]+ files?|Reading notes\.txt' \
  && fail "a tool row was drawn with Calm on: $settled"
# The reply sits one blank row under the prompt: a hidden tool row that left its blank row behind
# would put two blank rows between them.
if printf '%s\n' "$settled" | awk '/^● anchor/ { exit (one == "" && two == "" ? 0 : 1) } { two = one; one = $0 }'; then
  fail "a hidden tool row left a blank row behind on Claude Code $CLAUDE_VERSION: $settled"
fi
[ -z "$(hull_column)" ] || fail "the boat stayed on screen after the run settled: $settled"
printf '%s\n' "$settled" | grep -Fq '● anchor' || fail "the reply is missing after the Calm-on run: $settled"

# An operational input: sent with its U+2063, hidden while its reply and the next ordinary
# prompt stay. Claude Code removes the separator, which is why the mod matches without it.
say_with_separator "$(printf '\xe2\x81\xa3FIRSTMATE_OP: v1 watcher: wake: reply with only the word ack.')"
wait_pane 160 '● ack' || fail "the operational input was not answered on Claude Code $CLAUDE_VERSION: $(pane)"
say "Reply with only the word steady."
wait_pane 160 '● steady' || fail "the ordinary prompt was not answered on Claude Code $CLAUDE_VERSION: $(pane)"
pane | grep -Fq 'FIRSTMATE_OP:' && fail "the operational user row was drawn with Calm on: $(pane)"
pane | grep -Fq '❯ Reply with only the word steady.' || fail "the ordinary user row was hidden with Calm on: $(pane)"

# Calm off: stock rendering returns for the rows already in the transcript.
say "/calm off"
wait_pane_count 80 "fm-calm: Calm is off." 2 || fail "/calm off did not answer on Claude Code $CLAUDE_VERSION: $(pane)"
[ "$(preference)" = off ] || fail "/calm off wrote '$(preference)' to config/calm instead of off"
restored=$(pane)
printf '%s\n' "$restored" | grep -Eq 'Read [0-9]+ files?' \
  || fail "the tool row did not come back after /calm off on Claude Code $CLAUDE_VERSION: $restored"
printf '%s\n' "$restored" | grep -Fq 'FIRSTMATE_OP: v1 watcher' \
  || fail "the operational row did not come back after /calm off on Claude Code $CLAUDE_VERSION: $restored"

say "/exit"
wait_pane 80 "Resume this session with" || fail "Claude Code $CLAUDE_VERSION did not exit cleanly: $(pane)"
pass "Claude Code $CLAUDE_VERSION live E2E drew the boat at the window width in palette entries 3 and 4 and moved it, hid tool rows and the operational row without leaving rows behind, kept ordinary rows, restored stock rendering after /calm off, and exited cleanly"
