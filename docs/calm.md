# Calm mode

Calm is a conversation presentation toggle for Firstmate primaries on Pi and on Claude Code.
It is off by default, and the last `/calm` choice persists for the effective Firstmate home across session starts and resumes.
Both harnesses read and write the same `config/calm` file, so a choice made on one is picked up by the other at its next session start, and [`configuration.md`](configuration.md#calm-preference-configcalm) owns the file and its resolution rules.
Calm changes presentation only: model context, session storage, input delivery and ordering, and exports are untouched, and toggling Calm off restores the harness's stock rendering.

## What both harnesses share

While Calm is active and an agent run is under way, Calm replaces the stock working indicator with a small two-row animated boat, and no separate Calm status row is added.
The water fills the usable width in standard ANSI blue and the complete boat is standard ANSI yellow.
The boat is deliberately calm: it moves one column every 880ms, while the water ripples on its own faster cadence so the surface stays alive between boat steps.
Its mainsail is directional, showing `<|` while travelling right and `|>` while travelling left, and it flips on the exact frame the boat turns at either edge.
Every resize reflows the sprite without wrapping, and it disappears when the run settles, aborts, or fails.
Within one session, the next working period resumes the boat from its last rendered column and travel direction rather than restarting at the left edge.
Hidden elapsed time does not advance the animation, and a resize while hidden clamps the frozen boat to the new width without changing its valid travel direction.
A fresh session starts at the normal initial position.
Very narrow terminals fall back to a smaller deterministic sprite.
While Calm is off, the stock working indicator is left exactly as the harness renders it.
Calm also hides tool-call rows and canonically classified Firstmate operational user rows, which remain ordinary user-role messages with unchanged delivery, ordering, and authority.
Every hidden Firstmate input stays available to the model and in serialized session data and exports.

The harness-specific sections below own what else each harness hides, how Calm loads, and the boundaries of its supported presentation API.
The Pi extension and the Claude Code mod keep separate copies of the sprite because a marketplace-loaded mod cannot import another file of this repository, and `tests/fm-calm-claude-mod.test.sh` replays both through the same seeded sequence of renders, ticks, resizes, freezes, and resets so the two cannot drift.

## Pi

Pi loads the tracked `.pi/extensions/fm-calm.ts` once its project trust prompt is approved.
While Calm is active, it hides Pi's built-in `Working...` row and shows the boat in its place.
Calm also hides collapsed thinking labels, mid-turn assistant working notes, the shells for the Pi built-in tool names Calm owns, the `fm_watch_arm_pi` and `fm_branch_outcomes` tool shells, and canonically classified Firstmate operational user rows.
A mid-turn working note is assistant text in a message the model did not end its response with, identified by that message's own `stopReason` of `toolUse`, or of `length` with tool calls present.
Hiding it removes the narration a model emits alongside its tool calls, while the genuine reply that ends a response stays visible.
Text that is still streaming is never hidden, because suppressing it would also stop a genuine reply from streaming, so a working note is briefly visible before its row collapses.
The narration is hidden only from the live transcript presentation, and remains in the message, model context, session storage, and `/export` artifacts.
The operational inputs Calm classifies remain ordinary user-role messages, while Pi's transcript layout renders their complete rows at zero height.
The session-start nudge remains on its existing non-displayed custom-message path.

Outside Pi's same-name built-in override collision described below, Calm changes presentation only.
Calm's built-in wrappers preserve Pi's execution behavior, and input delivery, ordering, model context, session storage, diagnostics, and `/export` and `/share` operation remain unchanged.
Legacy operational custom messages remain in session data and Pi's sidebar tree; depending on the Pi version, the main HTML transcript either omits them or includes them as rows hidden by default.
Toggling Calm off restores ordinary rendering, and `Ctrl+O` expansion state is preserved.

Pi's supported presentation API does not expose a global transcript filter.
Expanded reasoning and its reserved spacing, built-in tool images, user-bash rows, skill and summary rows, generic status notices, and other arbitrary custom-tool or extension rows remain visible.
These are supported-API boundaries rather than hidden-content failures.

### Pi compatibility

Calm has no numeric Pi version minimum or maximum and never refuses Pi solely because its version is newer than a previously verified version.
The collapsed-thinking and operational-user-row presentation adapters probe the exact Pi API seam they patch when Calm loads.
If Pi removes one of those seams, Calm logs a diagnostic naming the unavailable adapter and skips only that adapter; `/calm`, the other adapter, and unrelated Pi extensions remain available.

Calm's built-in tool presentation (`bash`, `read`, `edit`, `write`, `grep`, `find`, `ls`) shares Pi's single, unmerged override slot per name with any other extension that overrides the same tool.
While the persisted Calm preference is off, Calm registers none of those overrides and therefore contests no built-in tool name.
The first time Calm turns on in a session that started off, it claims every built-in name no other extension already owns, leaves every contested tool intact and callable, and displays a prominent warning naming the tools it skipped.
Tool-call rows already on screen before that first toggle do not retroactively collapse; later rows for the names Calm claimed use Calm presentation.
When a session starts or reloads with Calm already on, Calm must instead register all seven overrides synchronously so Pi can render restored rows with them.
Pi provides no ownership check early enough for that load-time path, and the first registrant wins the complete tool definition.
If the other extension wins, a session-start console diagnostic names the tool and winning extension; if Calm wins, Pi does not expose the losing registration, so the other extension's override is unavailable and cannot be named.

[`calm-mode-feasibility.md`](calm-mode-feasibility.md) owns the version-scoped renderer taxonomy, built-in override constraints, and empirical evidence.
`.pi/extensions/lib/fm-calm-visibility.ts` owns the visibility policy, `.pi/extensions/lib/fm-calm-operational-user-layout.ts` owns the zero-height operational-user row adapter, and `.pi/extensions/lib/fm-calm-working-ship.ts` owns the animated working presentation.

## Claude Code

On Claude Code, Calm is a mod: the plugin in `.claude/plugins/fm-calm`, which needs Claude Code 2.1.287 or newer, the first release with mods.
It registers `/calm`, which toggles Calm and also takes an explicit `on`, `off`, or `status` argument.
The command runs the mod's own function with no model turn and works while Claude is working, and it answers with one short line such as `Calm is on.`.
Like any command output, that line is part of the conversation the model reads on its next turn.
The mod reloads `config/calm` at its own start and again at every session start, resume, clear, and compaction, as Pi does on every session start, and a toggle replaces the file atomically before the presentation changes.
If the file cannot be replaced, the choice is unchanged and the reply says so.
A session that runs outside any Firstmate home, with no `FM_HOME`, `FM_ROOT_OVERRIDE`, or `FM_CONFIG_OVERRIDE` and no Firstmate checkout at its root or working directory, has no preference file and never writes one.

### Loading

The tracked `.claude/settings.json` declares the repo-local marketplace in `.claude/plugins` and enables `fm-calm` from it, with a relative path so every clone and worktree resolves its own copy.
The plugin lives in `.claude/plugins` because Claude Code scans neither that directory nor reads hooks from it, which leaves the tracked `.claude/skills` symlink and the project hooks in `.claude/settings.json` undisturbed.
Plain `claude` launched in a checkout therefore loads the mod after the one step Claude Code asks of every project: accept the folder trust prompt once.
Claude Code then registers the marketplace in the background and loads the plugin in place from the checkout, so `/calm` is available in the first session.
The marketplace registration is user-global in Claude Code, so each checkout that opens re-points it at its own path, and a session that starts while it names a removed worktree loads the mod a moment later, once Claude Code has reconciled it.

To load the mod for one session without the project settings, launch `claude --plugin-dir <absolute path>/.claude/plugins/fm-calm`.
A Firstmate home that runs upstream firstmate code, which lacks these tracked files, loads the mod from a clone of this fork by setting `CLAUDE_CODE_PLUGIN_DIRS` to the absolute path of that clone's `.claude/plugins/fm-calm`, in the `env` block of `~/.claude/settings.json` or in the shell that starts `claude`.
The mod then loads in every Claude Code session of that user, which is safe: it reads only the three home variables and the Firstmate checkout marker, and writes nothing outside the `config` directory of a resolved home.

The mod follows the home a session resolves to, so a worker pane that inherits the primary's `FM_HOME` follows the primary's choice, while a worker in its own worktree without `FM_HOME` resolves to that worktree's own absent `config/calm` and stays off.

Mods draw only in the terminal and in the Code tab of the Desktop app.
The VS Code chat panel, `claude -p`, the Agent SDK, and cloud sessions run the mod's hooks and draw nothing, which changes no behavior: `/calm` still answers and persists the choice, and the model context is never touched.

### What the mod draws

- **Spinner:** while Calm is on and a turn is under way, the boat replaces the stock spinner outright, with no word, message, or token count beside it.
  The terminal draws it with entries 4 and 3 of its own 256-colour palette, which are what the standard blue and yellow escape codes select, because Claude Code resolves a named colour such as `blue` through its own theme instead; other surfaces are given the names.
- **Tool rows:** `ToolUse`, `ToolResult`, `ToolGroup`, and `ToolProgress` render as an empty box that takes no rows.
- **Operational user rows:** a `UserMessage` whose text is `FIRSTMATE_OP: v<n> <kind>: <body>`, the `[fm-from-firstmate]` carrier, or either legacy prefix proven by its U+2063 separator renders as an empty box, and every ordinary user row stays as drawn.
  Claude Code drops U+2063 from input typed or pasted into its composer, so an operational input sent to a Claude pane reaches the mod without it, and the mod matches the header with or without the separator.
  [`bin/fm-operational-input.sh`](../bin/fm-operational-input.sh) owns the protocol, and the mod matches its permanent `FIRSTMATE_OP:` header rather than a list of kinds, so a new kind stays hidden.

With Calm off, every one of those sites goes through the stock drawing untouched, and toggling Calm off redraws them at once.
The mod hooks no prompt, session-append, tool, or agent event, makes no model call or network request, and never touches what the model sees.

### Claude Code boundaries

The mods API does not expose these, so they remain visible with Calm on.
These are supported-API boundaries rather than hidden-content failures.

- **Mid-turn assistant working notes** stay visible.
  An `AssistantMessage` site receives only its block's text and whether it opens a reply, `turn.step` results carry no message identity, and the session transcript the API returns carries none either, so a note cannot be told from the reply that ends a response without guessing from its text, and a wrong guess would hide a genuine reply.
- **Collapsed thinking rows** and the `Baked for 3s` turn-duration line are not hidden; thinking has no render site, and the duration line is the stock completion line.
- **The permission prompt and the question dialog** are never touched: the permission prompt is not a render site and the question dialog is drawn by the engine alone.
- **The detailed transcript view (`Ctrl+O`)** draws through the same sites, so tool rows stay hidden there too until Calm is turned off.
- **The boat appears only where Claude Code draws its spinner.**
  While a long reply streams on the main screen Claude Code draws no spinner row of its own, so there is nothing to replace.
- **A reload of the mod** resets the boat's resting column, because the animation state lives in the mod's own memory, and a run already under way keeps the stock spinner until the next one starts; `/clear` and `/resume` reset the column by design.

## Regression entry points

```sh
tests/fm-calm-pi-extension.test.sh
tests/fm-pi-branch-extension.test.sh
tests/fm-pi-primary-types.test.sh
FM_PI_LIVE_E2E=1 tests/fm-pi-primary-live-e2e.test.sh
tests/fm-calm-claude-mod.test.sh
claude plugin validate --strict .claude/plugins/fm-calm
claude plugin test .claude/plugins/fm-calm
FM_CALM_CLAUDE_LIVE_E2E=1 tests/fm-calm-claude-mod-live-e2e.test.sh
```

`tests/fm-calm-claude-mod.test.sh` runs the two `claude plugin` commands against the installed Claude Code and prints a skip line where it is absent or older than 2.1.287.
The opt-in live guard drives a short real terminal session with a small model and fails naming the Claude Code version when a vendor fact the mod stands on changes; [`verification/runtime-backends.md`](verification/runtime-backends.md#claude-code-calm-mod) records those facts.
The real-terminal captures that show the boat, the hidden rows, and the stock rendering back after `/calm off` are in [`evidence/calm-claude-mod/`](evidence/calm-claude-mod/README.md).
