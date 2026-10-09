#!/usr/bin/env bash
# Claude Code fleet mod: strict plugin validation, the engine-run plugin test suite, repository
# loading consistency, and a contract test that feeds the real Bearings snapshot through the mod's
# reader.
#
# The mod is .claude/plugins/fm-fleet and needs Claude Code 2.1.290 or newer. Where `claude` is
# absent or older, the checks that need it print a skip line and the rest still run.
set -u

# shellcheck source=tests/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

TMP_ROOT=$(fm_test_tmproot fm-fleet-claude-mod)
PLUGIN="$ROOT/.claude/plugins/fm-fleet"
MARKETPLACE="$ROOT/.claude/plugins"
SNAPSHOT_READER="$PLUGIN/lib/snapshot.ts"
SNAPSHOT="$ROOT/bin/fm-bearings-snapshot.sh"
# The first release that redraws a pane or band whose height changes with the data without
# looping, and that draws a link inside a pane.
MIN_CLAUDE=2.1.290

# The calls the mod is allowed to make, exactly. Anything else on the list is a new capability the
# review has to see: the mod is a window, and it reaches the fleet only through one command.
EXPECTED_CALLS='$.clock.every $.clock.now $.command.register $.env.get $.fs.exists $.process.run $.session.root $.state.get $.state.set $.ui.close $.ui.open $.ui.panes $.ui.resolve'
EXPECTED_ENV_READS='FM_HOME FM_ROOT_OVERRIDE FM_TASK_ID'

# Prints the dotted version of an installed claude, or nothing when it is absent.
claude_version() {
  command -v claude >/dev/null 2>&1 || return 0
  claude --version 2>/dev/null | sed -n 's/^\([0-9][0-9]*\(\.[0-9][0-9]*\)*\).*/\1/p' | head -n 1
}

# True when $1 is the same as or newer than $2 (dotted numeric versions).
version_at_least() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n 1)" = "$2" ]
}

# Runs claude against a scratch configuration directory, so the operator's own settings (a
# disableAllHooks, say) cannot change what the plugin commands report.
claude_isolated() {
  CLAUDE_CONFIG_DIR="$TMP_ROOT/claude-config" claude "$@"
}

# Prints the sorted, de-duplicated items of the `<label>:` line of a validate report, with each
# "(via helper)" note removed and the "$." and separators normalized to a space-separated list.
report_items() {  # <report> <label>
  printf '%s\n' "$1" |
    sed -n "s/^.*register\\.ts $2: //p" |
    sed 's/ (via [^)]*)//g' |
    tr ',' '\n' |
    sed 's/^ *//; s/ *$//' |
    sort -u |
    paste -sd' ' -
}

test_plugin_validates_strictly_with_minimal_calls() {
  local version report calls hooks env_reads
  version=$(claude_version)
  if [ -z "$version" ]; then
    echo "skip: claude not found, so the fleet mod was not validated"
    return 0
  fi
  if ! version_at_least "$version" "$MIN_CLAUDE"; then
    echo "skip: claude $version is older than $MIN_CLAUDE, so the fleet mod was not validated"
    return 0
  fi

  report=$(claude_isolated plugin validate --strict "$PLUGIN" 2>&1) \
    || fail "claude plugin validate --strict failed for the fleet mod: $report"
  assert_contains "$report" "Validation passed" "validate did not report success"

  calls=$(report_items "$report" calls)
  [ "$calls" = "$EXPECTED_CALLS" ] \
    || fail "the fleet mod's calls changed; expected [$EXPECTED_CALLS] but validate lists [$calls]"
  env_reads=$(report_items "$report" 'env reads')
  [ "$env_reads" = "$EXPECTED_ENV_READS" ] \
    || fail "the fleet mod's environment reads changed; expected [$EXPECTED_ENV_READS] but validate lists [$env_reads]"
  assert_contains "$report" "env writes: nothing" "the fleet mod writes an environment variable"
  assert_contains "$report" "state reads: fm-fleet.fleet" "the fleet mod reads state it does not own"
  assert_contains "$report" "state writes: fm-fleet.fleet" "the fleet mod writes state it does not own"

  hooks=$(printf '%s\n' "$report" | sed -n 's/^.*register\.ts hooks: //p')
  assert_contains "$hooks" "command.run{command=fleet}" "the /fleet command is not hooked"
  assert_contains "$hooks" "ui.render{component=Pane, requestId=fm-fleet}" "the fleet pane is not drawn"
  assert_contains "$hooks" "ui.render{component=AbovePrompt}" "the band above the prompt is not drawn"
  assert_contains "$hooks" "session.start" "the session start is not hooked"
  assert_contains "$hooks" "turn.complete" "the turn end is not hooked"
  assert_contains "$hooks" "classic.SessionStart" "the fleet is not read again at a session reset"
  # The fleet view is a window. These are the events that would reach what the model sees, what
  # it may call, or the telemetry and network around them.
  case "$hooks" in
    *prompt.*|*session.append*|*tool.call*|*tool.check*|*agent.*|*telemetry*|*http.*|*model.*)
      fail "the fleet mod hooks an event that can reach what the model sees: $hooks"
      ;;
  esac

  report=$(claude_isolated plugin validate --strict "$MARKETPLACE" 2>&1) \
    || fail "claude plugin validate --strict failed for the repo-local marketplace: $report"
  assert_contains "$report" "Validation passed" "marketplace validate did not report success"
  pass "Claude Code $version validates the fleet mod and its marketplace strictly, with exactly the expected hooks, calls, state, and environment reads"
}

test_plugin_test_suite_passes() {
  local version output
  version=$(claude_version)
  if [ -z "$version" ] || ! version_at_least "$version" "$MIN_CLAUDE"; then
    echo "skip: claude ${version:-absent} cannot run the fleet mod's plugin tests (needs $MIN_CLAUDE or newer)"
    return 0
  fi

  output=$(claude_isolated plugin test "$PLUGIN" 2>&1) \
    || fail "claude plugin test failed for the fleet mod: $output"
  assert_contains "$output" " 0 fail" "the plugin test run did not report zero failures"
  assert_not_contains "$output" "(fail)" "a plugin test failed"
  pass "Claude Code $version runs the fleet mod's plugin tests: $(printf '%s\n' "$output" | grep -E '^ [0-9]+ pass' | tr -d '\n')"
}

# The captain installs the mod from the repo-local marketplace, so the marketplace entry, the
# manifest, and the hooks file must agree. The project settings must not enable it: a worker's
# session in a task copy of this repository would then load it, and a worker has no fleet to show.
test_repository_loading_files_agree() {
  local out
  if ! command -v node >/dev/null 2>&1; then
    echo "skip: node not found, so the repository loading files were not compared"
    return 0
  fi
  out=$(ROOT="$ROOT" node --input-type=module 2>&1 <<'JS'
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.env.ROOT;
const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const settings = read(".claude/settings.json");
const marketplace = read(".claude/plugins/.claude-plugin/marketplace.json");
const fail = (message) => { throw new Error(message); };

const entry = marketplace.plugins.find((plugin) => plugin.name === "fm-fleet");
if (!entry) fail("the marketplace does not list fm-fleet");
if (entry.source !== "./fm-fleet") fail(`fm-fleet must load in place by a relative source, found ${entry.source}`);
if (entry.version !== undefined) fail("the version belongs in plugin.json alone");
const manifest = read(".claude/plugins/fm-fleet/.claude-plugin/plugin.json");
if (manifest.name !== "fm-fleet") fail(`plugin.json names ${manifest.name}`);
if (manifest.types !== "./types/index.d.ts") fail(`plugin.json points the state contract at ${manifest.types}`);
if (!existsSync(join(root, ".claude/plugins/fm-fleet/types/index.d.ts"))) fail("the state contract is missing");
if (!existsSync(join(root, ".claude/plugins/fm-fleet/hooks/hooks.json"))) fail("hooks.json is missing");
const hooks = read(".claude/plugins/fm-fleet/hooks/hooks.json");
if (hooks.modules?.join() !== "./register.ts") fail(`hooks.json loads ${hooks.modules}`);
const enabled = Object.keys(settings.enabledPlugins ?? {}).filter((key) => key.startsWith("fm-fleet@"));
if (enabled.length !== 0) fail(`the project settings enable ${enabled.join()}; the fleet view is installed from the marketplace, not enabled by the project`);
console.log("consistent");
JS
  ) || fail "the repository loading files disagree: $out"
  [ "$out" = consistent ] || fail "unexpected repository loading check output: $out"
  pass "the marketplace, the plugin manifest, and the hooks file agree, and the project settings leave the fleet view to a marketplace install"
}

# The mod runs one command with fixed arguments and trusts its output's shape. This runs that
# same command against a seeded home and feeds the output through the mod's own reader, so a
# change to the snapshot that the mod cannot read fails here and not on the captain's screen.
test_real_snapshot_is_read_by_the_mod() {
  local home fakebin args out gen
  if ! command -v node >/dev/null 2>&1; then
    echo "skip: node not found, so the real snapshot was not read through the mod"
    return 0
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "skip: jq not found, so the real snapshot was not read through the mod"
    return 0
  fi

  home="$TMP_ROOT/home"
  mkdir -p "$home/state" "$home/data" "$home/config" "$home/projects/wt" "$TMP_ROOT/fixture-root"
  cat > "$home/data/backlog.md" <<'BACKLOG'
## In flight
- [ ] ship-task - Ship the thing (repo: sample-app) (kind: ship) (since 2026-07-11)

## Queued
- [ ] live-gate - Real queued work blocked-by: ship-task - waits for the thing (repo: sample-app) (kind: ship) (since 2026-07-11)

## Done
- [x] done-a - Landed thing https://github.com/invented-org/sample-app/pull/7 (repo: sample-app) (kind: ship) (merged 2026-07-10)
BACKLOG
  fm_write_meta "$home/state/ship-task.meta" \
    "window=firstmate:fm-ship-task" \
    "worktree=$home/projects/wt" \
    "project=sample-app" \
    "harness=claude" \
    "kind=ship" \
    "mode=no-mistakes" \
    "pr=https://github.com/invented-org/sample-app/pull/9"
  gen=$("$ROOT/bin/fm-busy-event.sh" arm "$home/state" ship-task)
  "$ROOT/bin/fm-busy-event.sh" apply "$home/state" ship-task busy --gen "$gen" \
    --source claude-hook --event user-prompt-submit
  printf 'working: building the thing\n' > "$home/state/ship-task.status"

  fakebin=$(fm_fakebin "$TMP_ROOT")
  cat > "$fakebin/tmux" <<'SH'
#!/usr/bin/env bash
case "${1:-}" in
  display-message) printf '%%1\n' ;;
  capture-pane) printf 'all quiet\n> \n' ;;
esac
exit 0
SH
  cat > "$fakebin/no-mistakes" <<'SH'
#!/usr/bin/env bash
exit 0
SH
  chmod +x "$fakebin/tmux" "$fakebin/no-mistakes"

  args=$(SNAPSHOT_READER="$SNAPSHOT_READER" node --input-type=module -e '
    import { pathToFileURL } from "node:url";
    const { SNAPSHOT_ARGS } = await import(pathToFileURL(process.env.SNAPSHOT_READER).href);
    console.log(SNAPSHOT_ARGS.join(" "));
  ' 2>/dev/null) || fail "could not read the mod's snapshot arguments"
  [ -n "$args" ] || fail "the mod names no snapshot arguments"

  # shellcheck disable=SC2086
  out=$(PATH="$fakebin:$PATH" FM_ROOT_OVERRIDE="$TMP_ROOT/fixture-root" FM_HOME="$home" \
    FM_BEARINGS_NOW=2026-07-11T18:00:00Z "$SNAPSHOT" $args) \
    || fail "the snapshot refused the mod's arguments ($args): $out"
  printf '%s' "$out" > "$TMP_ROOT/real-snapshot.json"
  PATH="$fakebin:$PATH" FM_ROOT_OVERRIDE="$TMP_ROOT/fixture-root" FM_HOME="$home" \
    FM_BEARINGS_NOW=2026-07-11T18:00:00Z "$SNAPSHOT" --json > "$TMP_ROOT/older-snapshot.json" \
    || fail "the snapshot without the work fields failed"

  out=$(SNAPSHOT_READER="$SNAPSHOT_READER" DIR="$TMP_ROOT" node --input-type=module 2>&1 <<'JS'
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { parseSnapshot } = await import(pathToFileURL(process.env.SNAPSHOT_READER).href);
const fail = (message) => { throw new Error(message); };
const read = (name) => {
  const parsed = parseSnapshot(readFileSync(join(process.env.DIR, name), "utf8"));
  if (!parsed.isOk) fail(`${name}: ${parsed.reason}`);
  return parsed.reading;
};

const reading = read("real-snapshot.json");
const task = reading.work.find((row) => row.id === "ship-task");
if (!task) fail("the working piece is missing from the reading");
if (task.state !== "working" || task.repo !== "sample-app") fail(`the piece reads as ${JSON.stringify(task)}`);
if (task.title !== "Ship the thing") fail(`the piece has no title: ${JSON.stringify(task)}`);
if (task.since !== "2026-07-11") fail(`the piece has no start date: ${JSON.stringify(task)}`);
if (reading.prs["ship-task"] !== "https://github.com/invented-org/sample-app/pull/9") fail("the recorded pull request is missing");
const gate = reading.gates.find((row) => row.id === "live-gate");
if (!gate || gate.repo !== "sample-app" || gate.blockedBy.join() !== "ship-task" || gate.reason !== "waits for the thing") {
  fail(`the queued piece reads as ${JSON.stringify(gate)}`);
}
const landed = reading.landed.find((row) => row.id === "done-a");
if (!landed || landed.date !== "2026-07-10" || landed.what !== "Landed thing") fail(`the landed piece reads as ${JSON.stringify(landed)}`);
if (!reading.hasWorkFields) fail("a snapshot that was asked for the work fields reads as lacking them");

const older = read("older-snapshot.json");
if (older.hasWorkFields) fail("a snapshot without the work fields reads as having them");
if (older.work.some((row) => row.title !== null || row.since !== null)) fail("an older snapshot reads with titles");
if (older.work.length !== reading.work.length) fail("the work fields changed which pieces are listed");
console.log("read");
JS
  ) || fail "the mod cannot read the real snapshot: $out"
  [ "$out" = read ] || fail "unexpected snapshot reading output: $out"
  pass "the mod reads the real Bearings snapshot with and without the work fields"
}

test_plugin_validates_strictly_with_minimal_calls
test_plugin_test_suite_passes
test_repository_loading_files_agree
test_real_snapshot_is_read_by_the_mod
