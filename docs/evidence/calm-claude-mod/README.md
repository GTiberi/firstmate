# Calm on Claude Code: real-terminal captures

These are captures of one real Claude Code session with the Calm mod loaded, recorded on 2026-10-03 with Claude Code 2.1.289 and `--model haiku` in a 100 column tmux 3.6 window.
Each capture is `tmux capture-pane -p` text.
The version and plan banner and the usage notice were removed from each, and nothing else was edited.
[`../../calm.md`](../../calm.md) owns the behavior these captures show, and `tests/fm-calm-claude-mod.test.sh` owns the regression coverage.

## How the session was run

The session ran in a throwaway directory that is not a Firstmate checkout, with `FM_HOME` pointing at another throwaway directory, so none of Firstmate's project hooks fired and `config/calm` landed there.
`<fork clone>` stands for the checkout that holds `.claude/plugins/fm-calm`.

```sh
mkdir -p /tmp/calm-demo/harbor /tmp/calm-demo/home/config
printf 'anchor tide harbor\nsecond line\n' > /tmp/calm-demo/harbor/notes.txt
cd /tmp/calm-demo/harbor
env -i HOME="$HOME" PATH="$PATH" TERM=xterm-256color LANG=C.UTF-8 FM_HOME=/tmp/calm-demo/home \
  claude --plugin-dir "<fork clone>/.claude/plugins/fm-calm" --model haiku
```

The prompt for every run was `Use the Read tool on notes.txt five times, one call per step, then reply with only its first word.`
The session was ended with `/exit`, which exited cleanly.

## What the captures show

| Capture | Calm | What it shows |
|---|---|---|
| `01-calm-off-stock-working.txt` | off | The stock spinner line and the stock `Reading notes.txt` tool row during a run. |
| `02-calm-off-stock-settled.txt` | off | The settled run, with the stock `Read 1 file` row above the reply. |
| `03-calm-on-toggle.txt` | on | `/calm on` answers `fm-calm: Calm is on.`, and the earlier run's `Read 1 file` row is no longer drawn. |
| `04-calm-on-boat-start.txt` | on | The boat at its initial position in place of the spinner: the sail `<|` over the hull `\__/`, water filling the full width, no spinner word or token count. |
| `05-calm-on-boat-later.txt` | on | The same run 4.4 seconds later: the boat has moved five columns right with the sail unchanged, and the water has rippled. |
| `06-calm-on-settled-tool-rows-hidden.txt` | on | The settled run: the reply follows the prompt directly, with no tool row and no blank row left behind, and the boat is gone. |
| `07-calm-on-resized-to-40-columns.txt` | on | The window resized to 40 columns mid-run: the water row is exactly 40 columns, the boat keeps its column, and nothing wraps. |
| `08-calm-on-operational-row-hidden.txt` | on | A `FIRSTMATE_OP: v1 watcher:` input sent with its leading U+2063 draws no row while its reply `ack` and the ordinary prompt `Reply with only the word steady.` stay. |
| `09-calm-off-restored-history.txt` | off | After `/calm off` answers `fm-calm: Calm is off.`, the earlier `Read 5 files` row and the operational row are drawn again. |
| `10-calm-off-stock-working-again.txt` | off | A new run with the stock spinner and the stock tool row back. |
| `11-boat-ansi-codes.txt` | on | The escape codes of the two boat rows. |

The boat's water row measured exactly the window width in every frame of the run, 100 columns and 40 columns, and no frame wrapped.
The `8 messages hidden (/focus to show)` note in captures 08 and 09 is Claude Code's own and appears with Calm off as well.

## Checks made on the same session

`config/calm` under `FM_HOME` held these bytes, read with `od -c` right after each command:

```text
after /calm on:   o   n  \n
after /calm off:  o   f   f  \n
```

The input sent for capture 08 began with U+2063, built with `printf '\xe2\x81\xa3FIRSTMATE_OP: v1 watcher: wake: reply with only the word ack.'` and typed with `tmux send-keys -l`.
Claude Code stored the prompt without the separator: reading that session's transcript file under the Claude projects directory for `-tmp-calm-demo-harbor`, the stored text began with `F` (U+0046) and `'⁣' in text` was `False`.
That is why the mod matches the `FIRSTMATE_OP:` header with or without U+2063.

The spinner colors in capture 11 are `38;5;3` for the boat and `38;5;4` for the water: entries 3 and 4 of the terminal's own 256-colour palette, the same entries the standard yellow and blue escape codes select.
A named color in the same place, `yellow` or `blue`, was drawn as `38;5;220` and `38;5;68`, which are Claude Code's theme colors and not the standard palette.

## Plugin validation

`claude plugin validate --strict` on the plugin, run from `<fork clone>` with Claude Code 2.1.289.
The `calls:` list is the whole of what the mod asks Claude Code to do, and `tests/fm-calm-claude-mod.test.sh` fails if it changes.

```text
$ claude plugin validate --strict .claude/plugins/fm-calm
Validating plugin manifest: <fork clone>/.claude/plugins/fm-calm/.claude-plugin/plugin.json

Validating hooks: <fork clone>/.claude/plugins/fm-calm/hooks/hooks.json

  ❯ ./register.ts hooks: session.start, classic.SessionStart, command.run{command=calm}, turn.start, turn.complete, ui.render{component=Spinner}, ui.render{component=ToolUse|ToolResult|ToolGroup|ToolProgress}, ui.render{component=UserMessage}
  ❯ ./register.ts calls: $.clock.every (via startTicker), $.command.register, $.env.get (via calmPreferencePath), $.fs.exists (via firstmateCheckoutRoot), $.fs.read (via readCalmPreference), $.fs.write (via persistCalmPreference), $.process.run (via persistCalmPreference), $.session.cwd (via firstmateCheckoutRoot), $.session.root (via firstmateCheckoutRoot), $.ui.invalidate (via applyPresentation, startTicker), $.ui.resolve
  ❯ ./register.ts env writes: nothing
  ❯ ./register.ts env reads: FM_CONFIG_OVERRIDE, FM_HOME, FM_ROOT_OVERRIDE

✔ Validation passed
```

```text
$ claude plugin validate --strict .claude/plugins
Validating marketplace manifest: <fork clone>/.claude/plugins/.claude-plugin/marketplace.json

✔ Validation passed
```

```text
$ claude plugin test .claude/plugins/fm-calm
 79 pass
 0 fail
Ran 79 tests across 5 files. [1.96s]
```

## Refresh

Run the mod's two engine checks and the drift guards with `tests/fm-calm-claude-mod.test.sh`, then repeat the session above after a Claude Code upgrade and replace the captures it changes.
