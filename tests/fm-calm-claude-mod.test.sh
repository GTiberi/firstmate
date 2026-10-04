#!/usr/bin/env bash
# Claude Code Calm mod: strict plugin validation, the engine-run plugin test suite,
# repository-loading consistency, and drift guards against the Pi implementation and
# bin/fm-operational-input.sh.
#
# The mod is .claude/plugins/fm-calm and needs Claude Code 2.1.287 or newer. Where `claude`
# is absent or older, the checks that need it print a skip line and the rest still run.
set -u

# shellcheck source=tests/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

TMP_ROOT=$(fm_test_tmproot fm-calm-claude-mod)
PLUGIN="$ROOT/.claude/plugins/fm-calm"
MARKETPLACE="$ROOT/.claude/plugins"
PI_WORKING_SHIP="$ROOT/.pi/extensions/lib/fm-calm-working-ship.ts"
MOD_WORKING_SHIP="$PLUGIN/lib/working-ship.ts"
MOD_OPERATIONAL="$PLUGIN/lib/operational.ts"
OPERATIONAL_INPUT="$ROOT/bin/fm-operational-input.sh"
MIN_CLAUDE=2.1.287

# The calls the mod is allowed to make, exactly. Anything else on the list is a new capability
# the review has to see: the mod is presentation only and never reaches the model, the network,
# or the store.
EXPECTED_CALLS='$.clock.every $.command.register $.env.get $.fs.exists $.fs.read $.fs.write $.process.run $.session.cwd $.session.root $.ui.invalidate $.ui.resolve'
EXPECTED_ENV_READS='FM_CONFIG_OVERRIDE FM_HOME FM_ROOT_OVERRIDE'

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
    echo "skip: claude not found, so the Calm mod was not validated"
    return 0
  fi
  if ! version_at_least "$version" "$MIN_CLAUDE"; then
    echo "skip: claude $version is older than $MIN_CLAUDE, the first release with mods, so the Calm mod was not validated"
    return 0
  fi

  report=$(claude_isolated plugin validate --strict "$PLUGIN" 2>&1) \
    || fail "claude plugin validate --strict failed for the Calm mod: $report"
  assert_contains "$report" "Validation passed" "validate did not report success"

  calls=$(report_items "$report" calls)
  [ "$calls" = "$EXPECTED_CALLS" ] \
    || fail "the Calm mod's calls changed; expected [$EXPECTED_CALLS] but validate lists [$calls]"
  env_reads=$(report_items "$report" 'env reads')
  [ "$env_reads" = "$EXPECTED_ENV_READS" ] \
    || fail "the Calm mod's environment reads changed; expected [$EXPECTED_ENV_READS] but validate lists [$env_reads]"
  assert_contains "$report" "env writes: nothing" "the Calm mod writes an environment variable"

  hooks=$(printf '%s\n' "$report" | sed -n 's/^.*register\.ts hooks: //p')
  assert_contains "$hooks" "command.run{command=calm}" "the /calm command is not hooked"
  assert_contains "$hooks" "ui.render{component=Spinner}" "the spinner is not hooked"
  assert_contains "$hooks" "turn.start" "the turn start is not hooked"
  assert_contains "$hooks" "turn.complete" "the turn end is not hooked"
  assert_contains "$hooks" "classic.SessionStart" "the preference is not reloaded at a session reset"
  # Calm changes presentation only. These are the events that would reach what the model sees,
  # what it may call, or the telemetry and network around them.
  case "$hooks" in
    *prompt.*|*session.append*|*tool.call*|*tool.check*|*agent.*|*telemetry*|*http.*|*model.*)
      fail "the Calm mod hooks an event that can reach what the model sees: $hooks"
      ;;
  esac

  report=$(claude_isolated plugin validate --strict "$MARKETPLACE" 2>&1) \
    || fail "claude plugin validate --strict failed for the repo-local marketplace: $report"
  assert_contains "$report" "Validation passed" "marketplace validate did not report success"
  pass "Claude Code $version validates the Calm mod and its marketplace strictly, with exactly the expected hooks, calls, and environment reads"
}

test_plugin_test_suite_passes() {
  local version output
  version=$(claude_version)
  if [ -z "$version" ] || ! version_at_least "$version" "$MIN_CLAUDE"; then
    echo "skip: claude ${version:-absent} cannot run the Calm mod's plugin tests (needs $MIN_CLAUDE or newer)"
    return 0
  fi

  output=$(claude_isolated plugin test "$PLUGIN" 2>&1) \
    || fail "claude plugin test failed for the Calm mod: $output"
  assert_contains "$output" " 0 fail" "the plugin test run did not report zero failures"
  assert_not_contains "$output" "(fail)" "a plugin test failed"
  pass "Claude Code $version runs the Calm mod's plugin tests: $(printf '%s\n' "$output" | grep -E '^ [0-9]+ pass' | tr -d '\n')"
}

# Claude Code reads the marketplace and plugin the project settings name, so the three files must
# agree on names and paths. A plain `claude` in this checkout then loads the mod in place.
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

const declared = Object.entries(settings.extraKnownMarketplaces ?? {});
if (declared.length !== 1) fail(`expected one declared marketplace, found ${declared.length}`);
const [marketplaceName, declaration] = declared[0];
if (marketplaceName !== marketplace.name) {
  fail(`settings declare ${marketplaceName} but the marketplace is named ${marketplace.name}`);
}
if (declaration.source?.source !== "directory") fail("the marketplace is not a directory source");
if (declaration.source?.path !== "./.claude/plugins") {
  fail(`the marketplace path must stay relative to the project root, found ${declaration.source?.path}`);
}

const enabled = Object.entries(settings.enabledPlugins ?? {}).filter(([, on]) => on === true).map(([key]) => key);
if (enabled.join() !== `fm-calm@${marketplaceName}`) fail(`enabledPlugins is ${enabled.join() || "empty"}`);

const entry = marketplace.plugins.find((plugin) => plugin.name === "fm-calm");
if (!entry) fail("the marketplace does not list fm-calm");
if (entry.source !== "./fm-calm") fail(`fm-calm must load in place by a relative source, found ${entry.source}`);
const manifest = read(".claude/plugins/fm-calm/.claude-plugin/plugin.json");
if (manifest.name !== "fm-calm") fail(`plugin.json names ${manifest.name}`);
if (entry.version !== undefined) fail("the version belongs in plugin.json alone");
if (!existsSync(join(root, ".claude/plugins/fm-calm/hooks/hooks.json"))) fail("hooks.json is missing");
console.log("consistent");
JS
  ) || fail "the repository loading files disagree: $out"
  [ "$out" = consistent ] || fail "unexpected repository loading check output: $out"
  pass "the project settings, the repo-local marketplace, and the plugin manifest agree on names and relative paths"
}

# The mod cannot import the Pi extension's sprite (a mod loaded from a marketplace is copied on
# its own), so this replays both implementations through the same seeded sequence of renders,
# ticks, resizes, freezes, and resets and fails on the first frame or state that differs.
test_ship_matches_pi() {
  local out
  if ! command -v node >/dev/null 2>&1; then
    echo "skip: node not found, so the boat was not compared with the Pi extension's"
    return 0
  fi
  out=$(PI_SHIP="$PI_WORKING_SHIP" MOD_SHIP="$MOD_WORKING_SHIP" node --input-type=module 2>&1 <<'JS'
import { pathToFileURL } from "node:url";

const pi = await import(pathToFileURL(process.env.PI_SHIP).href);
const mod = await import(pathToFileURL(process.env.MOD_SHIP).href);

const fail = (message) => { throw new Error(message); };
const same = (label, left, right) => {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    fail(`${label}: pi ${JSON.stringify(left)} != mod ${JSON.stringify(right)}`);
  }
};

same("tick period", pi.CALM_WORKING_SHIP_TICK_MS, mod.CALM_WORKING_SHIP_TICK_MS);
same("ticks per move", pi.CALM_WORKING_SHIP_TICKS_PER_MOVE, mod.CALM_WORKING_SHIP_TICKS_PER_MOVE);

// A small deterministic generator, so the sequence is the same on every machine.
let seed = 20261003;
const next = (limit) => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed % limit;
};
const widths = [0, 1, 2, 3, 4, 5, 6, 9, 17, 40, 80, 132];

let frames = 0;
for (let run = 0; run < 40; run += 1) {
  const left = pi.createCalmWorkingShipAnimation();
  const right = mod.createCalmWorkingShipAnimation();
  for (let step = 0; step < 400; step += 1) {
    const operation = next(10);
    const width = widths[next(widths.length)];
    let label;
    if (operation < 5) {
      label = "tick";
      left.tick();
      right.tick();
    } else if (operation < 8) {
      label = `render(${width})`;
      const expected = left.render(width);
      const actual = right.render(width).map(mod.ansiRowOf);
      same(`${label} run ${run} step ${step}`, expected, actual);
      frames += 1;
    } else if (operation === 8) {
      label = `clampToWidth(${width})`;
      left.clampToWidth(width);
      right.clampToWidth(width);
    } else if (next(2) === 0) {
      label = "restoreLastRendered";
      left.restoreLastRendered();
      right.restoreLastRendered();
    } else {
      label = "reset";
      left.reset();
      right.reset();
    }
    same(`position after ${label} run ${run} step ${step}`, left.position(), right.position());
    same(`direction after ${label} run ${run} step ${step}`, left.direction(), right.direction());
    same(`water phase after ${label} run ${run} step ${step}`, left.waterPhase(), right.waterPhase());
  }
}
console.log(`identical over ${frames} frames`);
JS
  ) || fail "the Claude Code boat drifted from the Pi extension's: $out"
  case "$out" in
    "identical over "*" frames") ;;
    *) fail "unexpected boat comparison output: $out" ;;
  esac
  pass "the Claude Code boat and the Pi boat agree frame for frame ($out)"
}

# The script owns the operational-input protocol. Every row it builds must be hidden, with or
# without the invisible separator Claude Code's composer drops, and the legacy texts Pi leaves
# visible must stay visible here too.
test_operational_rows_match_the_protocol() {
  local dir kinds kind out
  if ! command -v node >/dev/null 2>&1; then
    echo "skip: node not found, so operational rows were not compared with the protocol script"
    return 0
  fi
  dir="$TMP_ROOT/operational"
  mkdir -p "$dir/hidden" "$dir/visible"

  kinds=$(bash -c ". '$OPERATIONAL_INPUT'; printf '%s' \"\$FM_OPERATIONAL_KINDS\"")
  [ -n "$kinds" ] || fail "could not read the operational kinds from $OPERATIONAL_INPUT"
  for kind in $kinds from-firstmate; do
    printf 'body of the %s input\nsecond line' "$kind" | "$OPERATIONAL_INPUT" encode "$kind" >"$dir/hidden/$kind" \
      || fail "the protocol script refused to encode kind $kind"
  done
  bash -c ". '$OPERATIONAL_INPUT'; printf '%s' \"\${FM_OPERATIONAL_PREFIX}an untyped legacy row\"" >"$dir/hidden/legacy-untyped"
  bash -c ". '$OPERATIONAL_INPUT'; printf '%s' \"\${FM_LEGACY_AWAY_PREFIX}2 items): review ready\"" >"$dir/hidden/legacy-away"

  bash -c ". '$OPERATIONAL_INPUT'; printf '%s' \"\$FM_LEGACY_SESSIONSTART\"" >"$dir/visible/legacy-session-start"
  bash -c ". '$OPERATIONAL_INPUT'; printf '%s' \"\${FM_LEGACY_WATCHER_PREFIX}wake\${FM_LEGACY_WATCHER_SUFFIX}\"" >"$dir/visible/legacy-watcher"
  bash -c ". '$OPERATIONAL_INPUT'; printf '%s' \"\${FM_LEGACY_TURNEND_PREFIX}recover the watcher\"" >"$dir/visible/legacy-turn-end"
  printf '%s' 'please run the tests' >"$dir/visible/ordinary"
  printf '%s' 'FIRSTMATE_OP: v1 watcher: ' >"$dir/visible/empty-body"
  printf '%s' 'explain FIRSTMATE_OP: v1 watcher: to me' >"$dir/visible/mentioned"

  out=$(DIR="$dir" MOD_OPERATIONAL="$MOD_OPERATIONAL" node --input-type=module 2>&1 <<'JS'
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { isFirstmateOperationalInput } = await import(pathToFileURL(process.env.MOD_OPERATIONAL).href);
const MARK = "⁣";
const fail = (message) => { throw new Error(message); };
const show = (text) => JSON.stringify(text);

const read = (kind) => readdirSync(join(process.env.DIR, kind)).map((name) => ({
  name,
  text: readFileSync(join(process.env.DIR, kind, name), "utf8"),
}));

let checked = 0;
for (const { name, text } of read("hidden")) {
  if (!isFirstmateOperationalInput(text)) fail(`${name} is not hidden: ${show(text)}`);
  checked += 1;
  const stripped = text.replaceAll(MARK, "");
  // Legacy rows are proven by the separator alone, so only the current forms survive its loss.
  if (!name.startsWith("legacy") && !isFirstmateOperationalInput(stripped)) {
    fail(`${name} without its separator is not hidden: ${show(stripped)}`);
  }
  if (!name.startsWith("legacy")) checked += 1;
}
for (const { name, text } of read("visible")) {
  if (isFirstmateOperationalInput(text)) fail(`${name} is hidden but must stay visible: ${show(text)}`);
  checked += 1;
}
console.log(`${checked} rows`);
JS
  ) || fail "operational row classification drifted from $OPERATIONAL_INPUT: $out"
  pass "the mod hides every operational input the protocol script builds, with and without U+2063, and leaves the legacy and ordinary rows visible ($out)"
}

test_plugin_validates_strictly_with_minimal_calls
test_plugin_test_suite_passes
test_repository_loading_files_agree
test_ship_matches_pi
test_operational_rows_match_the_protocol
