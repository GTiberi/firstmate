// Firstmate's fleet view for Claude Code, as a mod: a side pane that shows every project with work
// under way and where each piece stands, and, wherever the pane cannot dock, one line above the
// prompt.
//
// A window and nothing more. The only command this module runs is the Bearings snapshot
// (bin/fm-bearings-snapshot.sh --json --fields work), read-only, one run at a time; it steers no
// worker, merges nothing, answers nothing, and hooks no prompt, tool, agent, or model event.
//
// docs/fleet-mod.md owns the captain-facing contract. lib/snapshot.ts reads the snapshot,
// lib/model.ts arranges it in his words, lib/layout.ts draws it as rows cut to the width they are
// given, lib/cadence.ts decides when to read again, and lib/home.ts orders the places the home and
// the command may be.
//
// Every mods API call is written in full inside this file: the plugin validator follows `$` only
// through functions declared at the top level of the hooks module.
import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, On, RenderElement, Timer } from 'claude-code'

import type { FleetState } from '../types'
import { failureReasonOf, parseFleetCommand, USAGE } from '../lib/command'
import { isGapKept, isTickDue, READ_TIMEOUT_MS, TICK_MS } from '../lib/cadence'
import { codeRootCandidates, HOME_MARKER, homeOf, joinPath, snapshotPathIn } from '../lib/home'
import { bandRuns, type Frame, type Line, lineText, paneLines, type Run } from '../lib/layout'
import { buildModel, trackedRows, witness } from '../lib/model'
import { parseSnapshot, SNAPSHOT_ARGS } from '../lib/snapshot'

const PANE = 'fm-fleet'
const PANE_TITLE = 'Fleet'
// What the pane asks for when it docks beside the transcript.
const PANE_COLUMNS = 58
// The terminal width to draw for when the surface has not measured its window yet.
const FALLBACK_COLUMNS = 80
// The width /fleet status draws for: wide enough that nothing is cut.
const STATUS_COLUMNS = 400

const NOT_A_HOME = 'this folder is not a Firstmate home'

const EMPTY: FleetState = { reading: null, readAt: 0, failure: null, seen: {} }
const fleet = atom({ plugin: 'fm-fleet', key: 'fleet' } as const, EMPTY)

// Module variables start over when the mod reloads; session.start then runs again and starts the
// session's view from the top. The fleet itself lives in $.state, which a reload keeps.
const session: {
  /** Not the captain's interactive window (a print run, or a worker's pane): the mod stays silent. */
  isInert: boolean
  /** The folder is a Firstmate home, so the band may speak without being asked. */
  isReady: boolean
  /** /fleet was typed here, so the band may say what is wrong even in a folder that is no home. */
  isAsked: boolean
  isAutoOpened: boolean
  /** When the last read started; 0 before the first. */
  lastStartedAt: number
  reading: Promise<void> | undefined
  timer: Timer | undefined
} = {
  isInert: false,
  isReady: false,
  isAsked: false,
  isAutoOpened: false,
  lastStartedAt: 0,
  reading: undefined,
  timer: undefined,
}

type Located = { isOk: true; codeRoot: string } | { isOk: false; reason: string }

/** The code root that holds the snapshot command, provided the home it serves has runtime records. */
async function locateHome($: EngineInterface): Promise<Located> {
  const env = {
    fmHome: await $.env.get('FM_HOME'),
    fmRootOverride: await $.env.get('FM_ROOT_OVERRIDE'),
  }
  let root: string | undefined
  // A session that cannot name its project root has no home there, not a failed start.
  try {
    root = await $.session.root()
  } catch {
    // no project root
  }
  for (const candidate of codeRootCandidates(env, { root })) {
    try {
      if (!(await $.fs.exists(snapshotPathIn(candidate)))) continue
      if (await $.fs.exists(joinPath(homeOf(env, candidate), HOME_MARKER))) {
        return { isOk: true, codeRoot: candidate }
      }
    } catch {
      // an unreadable directory is not a home
    }
  }
  return { isOk: false, reason: NOT_A_HOME }
}

async function recordFailure(
  $: EngineInterface,
  kind: 'unavailable' | 'not-a-home',
  reason: string,
  at: number,
): Promise<void> {
  await update($, fleet, (state) => ({ ...state, failure: { kind, reason, at } }))
}

/**
 * One read: locate the home, run the snapshot once with a timeout, and keep the result. A failed
 * read keeps the last good reading and records why; it never throws.
 */
async function readFleet($: EngineInterface): Promise<void> {
  try {
    const located = await locateHome($)
    if (!located.isOk) {
      session.isReady = false
      await recordFailure($, 'not-a-home', located.reason, await $.clock.now())
      return
    }
    session.isReady = true
    let failure: string | undefined
    let parsed: ReturnType<typeof parseSnapshot> | undefined
    try {
      const out = await $.process.run([snapshotPathIn(located.codeRoot), ...SNAPSHOT_ARGS], {
        cwd: located.codeRoot,
        timeoutMs: READ_TIMEOUT_MS,
      })
      if (out.exitCode !== 0) {
        const detail = failureReasonOf(out.stderr)
        failure = detail === 'no reason given' ? `the snapshot exited ${out.exitCode}` : detail
      } else if (out.isStdoutTruncated) {
        failure = 'the snapshot was too large to read'
      } else {
        parsed = parseSnapshot(out.stdout)
        if (!parsed.isOk) failure = parsed.reason
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failure = /time(d)? ?out/i.test(message)
        ? `the snapshot took longer than ${READ_TIMEOUT_MS / 1000} seconds`
        : failureReasonOf(message)
    }
    const finished = await $.clock.now()
    if (failure !== undefined || parsed === undefined || !parsed.isOk) {
      await recordFailure($, 'unavailable', failure ?? 'no reading', finished)
      return
    }
    const reading = parsed.reading
    await update($, fleet, (state) => ({
      reading,
      readAt: finished,
      failure: null,
      seen: witness(state.seen, trackedRows(reading), finished, state.reading === null),
    }))
  } catch {
    // A read that fails in the engine itself leaves the screen as it was; the next tick retries.
  }
}

/** Starts a read unless one is under way, in which case it joins that one: two never overlap. */
function beginRead($: EngineInterface, now: number): Promise<void> {
  if (session.reading !== undefined) return session.reading
  session.lastStartedAt = now
  const running = readFleet($).finally(() => {
    session.reading = undefined
  })
  session.reading = running
  return running
}

/** A read that starts by itself (a turn ending): skipped inside the minimum gap after the last. */
async function readAfterTurn($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (!isGapKept(now, session.lastStartedAt)) return
  void beginRead($, now)
}

async function isPaneShown($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some((pane) => pane.id === PANE && pane.isPlaced)
  } catch {
    return false
  }
}

/** One tick of the timer: a read when the interval for what is showing has passed. */
async function tick($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const state = await read($, fleet)
  const isPaneOpen = await isPaneShown($)
  if (isTickDue(now, session.lastStartedAt, { isPaneOpen, isFailing: state.failure !== null })) {
    void beginRead($, now)
  }
}

function startTimer($: EngineInterface): void {
  if (session.timer !== undefined) return
  session.timer = $.clock.every(TICK_MS, () => {
    void tick($).catch(() => undefined)
  })
}

async function frameOf($: EngineInterface): Promise<Frame> {
  const state = await read($, fleet)
  const now = await $.clock.now()
  return {
    model: state.reading === null ? null : buildModel(state.reading, state.seen, now),
    readAt: state.readAt,
    failure: state.failure,
    now,
  }
}

/** The band's one line as plain text, for /fleet status. */
async function statusText($: EngineInterface): Promise<string> {
  const runs = bandRuns(await frameOf($), STATUS_COLUMNS, true)
  return runs === null ? 'Fleet: nothing to show.' : lineText(runs)
}

type Parts = {
  Text: Elements['terminal']['Text']
  Link: Elements['terminal']['Link']
}

/** One run as an element: its tone becomes a theme colour, and an address becomes a link. */
function runElement(run: Run, { Text, Link }: Parts): RenderElement {
  const style: { bold?: true; dimColor?: true; color?: string } = {}
  if (run.bold === true) style.bold = true
  if (run.tone === 'dim') style.dimColor = true
  else if (run.tone === 'warning' || run.tone === 'error' || run.tone === 'success') style.color = run.tone
  if (run.href !== undefined) {
    return Text({ ...style, children: [Link({ href: run.href, label: run.text })] })
  }
  return Text({ ...style, children: [run.text] })
}

function lineElement(line: Line, parts: Parts): RenderElement {
  return parts.Text({ wrap: 'truncate-end', children: line.map((run) => runElement(run, parts)) })
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    const task = await $.env.get('FM_TASK_ID')
    // A worker's pane carries FM_TASK_ID, and a print run has nobody to show the fleet to.
    session.isInert = !e.isInteractive || (task !== undefined && task !== '')
    if (!session.isInert) {
      try {
        await $.command.register({
          name: 'fleet',
          description: 'Show every project with work under way and where each piece stands (close, refresh, status).',
          argumentHint: '[close|refresh|status]',
          immediate: true,
        })
      } catch {
        // A name another plugin already took leaves the mod without its command, not the session.
      }
      const located = await locateHome($)
      if (located.isOk) {
        session.isReady = true
        startTimer($)
        void beginRead($, await $.clock.now())
      } else {
        await recordFailure($, 'not-a-home', located.reason, await $.clock.now())
      }
    }
    return next(e)
  })

  // /clear, /resume, and /branch start $.state over, so the view needs a fresh reading.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    if (!session.isInert && session.isReady) void beginRead($, await $.clock.now())
    return next(e)
  })

  // A subagent's turn ends with its own agentId and says nothing about the main run.
  on('turn.complete', ($, e, next) => {
    if (!session.isInert && session.isReady && e.agentId === undefined) {
      void readAfterTurn($).catch(() => undefined)
    }
    return next(e)
  })

  on('command.run', { command: 'fleet' }, async ($, e) => {
    const command = parseFleetCommand(e.args)
    if (command === undefined) return { text: USAGE }
    session.isAsked = true

    if (command === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Fleet pane closed. The line above the prompt is back.' }
    }
    if (command === 'status') {
      const state = await read($, fleet)
      if (state.reading === null && state.failure === null) await beginRead($, await $.clock.now())
      return { text: await statusText($) }
    }
    // Opening and refreshing both read now, joining a read already under way.
    await beginRead($, await $.clock.now())
    const state = await read($, fleet)
    if (command === 'open' && e.presentation.isFullscreen && state.failure?.kind !== 'not-a-home') {
      await $.ui.open({ id: PANE, title: PANE_TITLE, columns: PANE_COLUMNS })
    }
    return { text: await statusText($) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Link } = $.ui.resolve(e)
    const frame = await frameOf($)
    const lines = paneLines(frame, e.props.bodyColumns || FALLBACK_COLUMNS)
    return Box({
      flexDirection: 'column',
      children: lines.map((line) => lineElement(line, { Text, Link })),
    })
  })

  // The band above the prompt: the line shown wherever the pane is not up beside the transcript.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (session.isInert || e.props.hasSurvey || (!session.isReady && !session.isAsked)) return next(e)

    if (e.viewport?.isFullscreen === true) {
      const state = await read($, fleet)
      // Where the pane would dock it opens once per load, so the picture is there without asking.
      if (!session.isAutoOpened && state.reading !== null) {
        session.isAutoOpened = true
        void $.ui.open({ id: PANE, title: PANE_TITLE, columns: PANE_COLUMNS })
      }
      if (await isPaneShown($)) return next(e)
    }

    const runs = bandRuns(await frameOf($), e.props.bodyColumns || FALLBACK_COLUMNS, session.isAsked)
    if (runs === null) return next(e)
    const { Box, Text, Link } = $.ui.resolve(e)
    // The band is shared: whatever the mods after this one draw stays, under the fleet's line.
    const theirs = await next(e)
    return Box({
      flexDirection: 'column',
      children: [lineElement([...runs], { Text, Link }), theirs],
    })
  })
}

