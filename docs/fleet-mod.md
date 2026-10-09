# Fleet view

The fleet view is a Claude Code mod, `fm-fleet`, that keeps the picture the Bearings digest gives in chat inside the session: every project with work under way and where each piece stands.
It is a window and nothing else: it steers no worker, merges nothing, answers no decision, and hooks no prompt, tool, agent, or model event.
It needs Claude Code 2.1.290 or newer, the first release that redraws a pane or band whose height follows its data without looping, and the mod is the plugin in `.claude/plugins/fm-fleet`.

## What it shows

Where the session is full screen and the terminal is at least 110 columns wide, the mod keeps a pane beside the transcript.
It opens the pane by itself once per load where the terminal is at least 144 columns wide, and `/fleet` opens it at 110.
Everywhere else, and whenever the pane is closed, one line above the prompt carries the picture instead.
The line yields while the pane is up, so the two never show at once.

The pane reads like the Bearings digest, grouped by project, in this order:

- **Waiting on you:** the open decisions and the pull requests ready for your word, each with its full `https://` address when one is recorded.
- **Under way:** one group per project, named as the registry names it, with one row per piece of work.
  A row holds a state word, the piece's title, what it is doing in a few words, how long it has been so, and its pull request address when one is recorded.
- **Recently landed:** the snapshot's bounded list of recent completions, newest first, each with its pull request address or report path.
- **Queued:** the work waiting to start, each with what it waits for in words, never in ids.

The state words are `working`, `waiting for a decision`, `stuck`, `failed`, `paused on an outside wait`, `finished`, and `state unclear` for a piece under way, and `waiting on another piece`, `waiting on a date`, `waiting for you`, and `ready to start` for queued work.
Nothing the pane shows is a task id, and a line the snapshot wrote in Firstmate's own terms is rewritten or left out.
Waiting items draw in the theme's warning tone and landed work draws dim.

Every row is cut to the pane's width with an ellipsis, so nothing wraps.
When a title and what the piece is doing do not fit one row, the second moves to a row under the first rather than being cut away.
An address that fits is plain text, which a terminal that links addresses links whole.
One that does not fit is cut in the middle, keeps both ends, and stays a link to the whole address.

The band is one line: how many pieces are working, how many wait on you, how many are queued, and the first words of the first thing that waits on you.
When nothing is under way it says `Fleet: nothing under way` and takes one row.
It shares the band with any other mod, drawing its line above whatever they draw.

## Where the facts come from

The mod runs one command and reads nothing else:

```sh
bin/fm-bearings-snapshot.sh --json --fields work
```

That is the Bearings snapshot, the one bounded and read-only reader the digest and the Lavish board are built from, with the opt-in `work` fields its header owns.
The `work` fields add each piece's title and start date, a queued piece's project and filed date, and a completed piece's completion date, and they change nothing in the default output.

The mod runs the command through the mods API with a 45 second timeout, one run at a time, from the code root that holds it, and keeps the parsed result in the session.
A run may refresh the parent-side cache of a remote home's ledger, as every Bearings snapshot may, and does nothing else.

The home is resolved as [`configuration.md`](configuration.md#fm_home) says: `FM_HOME`, then `FM_ROOT_OVERRIDE`, then the Firstmate checkout the session runs in.
The command is taken from the session's checkout, else from `FM_ROOT_OVERRIDE`, else from `FM_HOME`.
A folder is a Firstmate home only when the command is there and the home holds the `state` directory that bootstrap makes.

## When it reads

| Trigger | Rule |
| :- | :- |
| The session starts, or `/clear`, `/resume`, or `/branch` runs | Reads at once |
| `/fleet`, `/fleet refresh` | Reads now, or joins the read already under way |
| A turn of the main conversation ends | Reads, but never twice within 30 seconds |
| A timer, once a minute | Reads when the pane is open or the last read failed, else every five minutes |

A read never starts while another is under way.
When a read fails, the mod keeps the last good reading, shows `Fleet state unavailable` with the reason and how old the reading is, and tries again at the next minute tick.
The reading's age shows in the pane as `updated … ago`.

## Ages

The snapshot does not say how long a piece has been in its state, so the age on a row is one of two things.
When the pane watched the piece arrive in its state, the row shows how long ago, such as `5m` or `3h`.
Otherwise it shows the date the piece started, such as `Oct 8`, when the snapshot supplies it.
A piece already in its state when the session started has no watched age until it changes.

## /fleet

| Command | Effect |
| :- | :- |
| `/fleet` | Opens the pane when the session is full screen, reads now, and answers with the band's line |
| `/fleet refresh` | Reads now and answers with the band's line |
| `/fleet status` | Answers with the band's line, reading first only when there is no reading yet |
| `/fleet close` | Closes the pane and brings the line back |

The command runs in the mod with no model turn and works while Claude is working.
Like any command output, its one-line answer is part of the conversation the model reads on its next turn.
On a surface that draws neither the pane nor the band, `/fleet status` still gives the picture in the conversation.

## Install

The fleet view is not enabled by the repository's project settings, because a worker's session in a task copy of the repository would then load it.
Install it once from the repo-local marketplace, which this checkout declares as `firstmate-local`:

```sh
claude plugin install fm-fleet@firstmate-local
```

The plugin is read in place from the checkout, so a change that lands reaches the session after `/reload-plugins`.
To try it for one session without installing, launch `claude --plugin-dir <absolute path>/.claude/plugins/fm-fleet`.

## Where it stays silent

The mod draws nothing and runs nothing in a worker's pane, which carries `FM_TASK_ID`, and in `claude -p` and other runs with nobody to look.
In a folder that is not a Firstmate home it stays quiet, and `/fleet` says `this folder is not a Firstmate home` instead of reading anything.
The band is raised in the terminal and in the Desktop app only, and a pane is drawn wherever the surface places panes.

## Limits

- It shows what the snapshot shows, within the snapshot's bounds: when a list is cut short, the last row of the pane says so.
- A registered second mate's active pieces appear as the snapshot gives them, which carries neither a title nor a start date, so those rows lead with what the piece is doing.
- A code root that predates the `work` fields still works: rows lead with what the piece is doing, no start date shows, and one dim row says the reading has no titles or dates.
- The pane scrolls when the fleet is taller than it, with the keys Claude Code gives a focused pane.
- The band is one site shared by every mod.
  Where another mod draws its own band and does not pass the event on, and Claude Code runs it before this one, this line does not show, while the pane is unaffected.
  Claude Code decides the order among the mods you install, and the fleet view cannot choose its place; with `--plugin-dir`, the first directory named runs first.
- The pane shows no ages for decisions and queued work, because the snapshot gives no start for them.

## Regression entry points

```sh
bash tests/fm-fleet-claude-mod.test.sh
claude plugin validate --strict .claude/plugins/fm-fleet
claude plugin test .claude/plugins/fm-fleet
```

The shell suite runs the strict validation, which lists the mod's mods API calls and fails when one is added, the engine-run plugin tests, a check that the repository's loading files agree, and a contract test that feeds the real Bearings snapshot through the mod's reader.
