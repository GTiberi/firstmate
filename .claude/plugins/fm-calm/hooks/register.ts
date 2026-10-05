// Firstmate's home-persistent Calm presentation toggle for Claude Code, as a mod.
//
// While Calm is on and a turn is under way, an animated two-row boat replaces the stock spinner;
// whether Calm is on, tool rows, tool results, and Firstmate's operational user rows are drawn
// as nothing. Calm is presentation only: this module hooks no prompt, session.append, tool, or
// agent event, makes no model call and no network request, and never touches what the model
// sees. With Calm off every render site goes through next(e) untouched.
//
// docs/calm.md owns the captain-facing contract and the boundaries of the mods API, and
// docs/configuration.md "Calm preference" owns the config/calm file this module shares with the
// Pi /calm command. lib/working-ship.ts owns the sprite, lib/operational.ts the rows that count
// as Firstmate's own, and lib/preference.ts the file format and command words.
//
// Every mods API call is written in full inside this file: the plugin validator follows `$`
// only through functions declared at the top level of the hooks module.
import type { EngineInterface, On, Timer } from 'claude-code'

import { isFirstmateOperationalInput } from '../lib/operational'
import {
  calmPreferencePathOf,
  failureReasonOf,
  FIRSTMATE_CHECKOUT_MARKER,
  joinPath,
  parseCalmCommand,
  parseCalmPreference,
  serializeCalmPreference,
  temporaryPathOf,
} from '../lib/preference'
import {
  CALM_WORKING_SHIP_TICK_MS,
  colorPropOf,
  createCalmWorkingShipAnimation,
} from '../lib/working-ship'

// The terminal width to draw for when the surface has not measured its window yet.
const FALLBACK_COLUMNS = 80

const NO_HOME =
  'no Firstmate home: run Claude Code in a Firstmate checkout or set FM_HOME'

// Module variables start over when the mod reloads; session.start then reads the preference
// again, so the only thing a reload costs is the boat's resting column.
const state: { calm: boolean; turnActive: boolean; timer: Timer | undefined } = {
  calm: false,
  turnActive: false,
  timer: undefined,
}

// One animation instance for the life of the module. Stopping the ticker freezes it where it
// was last drawn; the next working period resumes there; a fresh session resets it.
const animation = createCalmWorkingShipAnimation()

let temporaryCounter = 0

/** The Firstmate checkout this session runs in, or undefined when it runs somewhere else. */
async function firstmateCheckoutRoot($: EngineInterface): Promise<string | undefined> {
  const candidates: string[] = []
  // A session that cannot name a directory has no checkout there, not a failed start.
  try {
    candidates.push(await $.session.root())
  } catch {
    // no project root
  }
  try {
    candidates.push(await $.session.cwd())
  } catch {
    // no working directory
  }
  for (const candidate of candidates) {
    try {
      if (await $.fs.exists(joinPath(candidate, FIRSTMATE_CHECKOUT_MARKER))) return candidate
    } catch {
      // an unreadable directory is not a checkout
    }
  }
  return undefined
}

/**
 * The effective home's config/calm, resolved as docs/configuration.md says: FM_HOME, then
 * FM_ROOT_OVERRIDE, then the tracked code root, which for a mod is the Firstmate checkout the
 * session runs in. A session in an unrelated project resolves to no file at all.
 */
async function calmPreferencePath($: EngineInterface): Promise<string | undefined> {
  const fmHome = await $.env.get('FM_HOME')
  const fmRootOverride = await $.env.get('FM_ROOT_OVERRIDE')
  const fmConfigOverride = await $.env.get('FM_CONFIG_OVERRIDE')
  const isHomeNamed = [fmHome, fmRootOverride, fmConfigOverride].some(
    (value) => value !== undefined && value !== '',
  )
  const checkoutRoot = isHomeNamed ? undefined : await firstmateCheckoutRoot($)
  return calmPreferencePathOf({ fmHome, fmRootOverride, fmConfigOverride, checkoutRoot })
}

/** The stored choice: absent, unreadable, or unrecognized reads as off. */
async function readCalmPreference($: EngineInterface): Promise<boolean> {
  const path = await calmPreferencePath($)
  if (path === undefined) return false
  try {
    return parseCalmPreference(await $.fs.read(path))
  } catch {
    return false
  }
}

type Persisted = { isSaved: true } | { isSaved: false; reason: string }

/**
 * Replaces config/calm atomically: a sibling temporary file is written, then renamed over the
 * file, so a reader never sees a partial value and a failure leaves the current file alone.
 * $.fs.write is not atomic, and the mods API has no rename, so the rename is one `mv`.
 */
async function persistCalmPreference($: EngineInterface, active: boolean): Promise<Persisted> {
  const path = await calmPreferencePath($)
  if (path === undefined) return { isSaved: false, reason: NO_HOME }
  temporaryCounter += 1
  const nonce = `${Math.random().toString(36).slice(2, 10)}${temporaryCounter}`
  const temporary = temporaryPathOf(path, nonce)
  try {
    await $.fs.write(temporary, serializeCalmPreference(active))
    const moved = await $.process.run(['mv', '-f', '--', temporary, path])
    if (moved.exitCode !== 0) {
      throw new Error(moved.stderr.trim() || `mv exited ${moved.exitCode}`)
    }
    return { isSaved: true }
  } catch (error) {
    await $.process.run(['rm', '-f', '--', temporary]).catch(() => undefined)
    return { isSaved: false, reason: failureReasonOf(error instanceof Error ? error.message : String(error)) }
  }
}

function stopTicker(): void {
  if (state.timer === undefined) return
  state.timer.cancel()
  state.timer = undefined
  // Hidden time never advances the boat: it rests where it was last drawn.
  animation.restoreLastRendered()
}

/**
 * The one scheduler behind both cadences: every tick ripples the water, every fourth moves the
 * boat. It runs only while Calm is on and a turn is under way, and one redraw per tick keeps
 * the engine's redraw throttle (ten a second) far away.
 */
function startTicker($: EngineInterface): void {
  if (state.timer !== undefined) return
  state.timer = $.clock.every(CALM_WORKING_SHIP_TICK_MS, () => {
    if (!state.calm || !state.turnActive) {
      stopTicker()
      return
    }
    animation.tick()
    $.ui.invalidate('ui.render')
  })
}

/** Starts or stops the ticker to match Calm and the turn, then redraws every hooked site. */
function applyPresentation($: EngineInterface): void {
  if (state.calm && state.turnActive) startTicker($)
  else stopTicker()
  $.ui.invalidate('ui.render')
}

/**
 * Reads config/calm into the live choice. A toggle made in another session of the same home,
 * or by Pi, is picked up here at every start, resume, and clear. A new session starts the boat
 * at its normal position; a compaction stays inside the same session and keeps it.
 */
async function reloadPreference(
  $: EngineInterface,
  isNewSession: boolean,
): Promise<void> {
  const stored = await readCalmPreference($)
  const isChanged = stored !== state.calm
  state.calm = stored
  if (isNewSession) {
    stopTicker()
    animation.reset()
  }
  if (isChanged || isNewSession) applyPresentation($)
}

function statusOf(active: boolean): string {
  return `Calm is ${active ? 'on' : 'off'}.`
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await reloadPreference($, true)
    try {
      await $.command.register({
        name: 'calm',
        description: "Toggle Firstmate's Calm transcript presentation (on, off, status).",
        argumentHint: '[on|off|status]',
        immediate: true,
      })
    } catch {
      // A name another plugin already took leaves the mod without its command, not the session.
    }
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    await reloadPreference($, e.source !== 'compact')
    return next(e)
  })

  on('command.run', { command: 'calm' }, async ($, e) => {
    const command = parseCalmCommand(e.args)
    if (command === undefined) return { text: 'Usage: /calm [on|off|status]' }
    if (command === 'status') return { text: statusOf(state.calm) }

    const target = command === 'toggle' ? !state.calm : command === 'on'
    const saved = await persistCalmPreference($, target)
    if (!saved.isSaved) {
      return {
        text: `Calm is still ${state.calm ? 'on' : 'off'}: could not save config/calm (${saved.reason}).`,
      }
    }
    state.calm = target
    applyPresentation($)
    return { text: statusOf(target) }
  })

  on('turn.start', ($, e, next) => {
    state.turnActive = true
    if (state.calm) startTicker($)
    return next(e)
  })

  // A subagent's turn ends with its own agentId and says nothing about the main run.
  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      state.turnActive = false
      stopTicker()
    }
    return next(e)
  })

  // The boat replaces the stock spinner outright: word, message, and suffix stay out of it.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!state.calm || !state.turnActive) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const rows = animation.render(e.viewport?.columns ?? FALLBACK_COLUMNS)
    return Box({
      flexDirection: 'column',
      children: rows.map((row) =>
        Box({
          flexDirection: 'row',
          children: row.map((run) =>
            run.color === undefined
              ? Text({ children: [run.text] })
              : Text({ color: colorPropOf(run.color, e.surface), children: [run.text] }),
          ),
        }),
      ),
    })
  })

  on(
    'ui.render',
    { component: ['ToolUse', 'ToolResult', 'ToolGroup', 'ToolProgress'] },
    async ($, e, next) => {
      if (!state.calm) return next(e)
      const { Box } = $.ui.resolve(e)
      return Box({})
    },
  )

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (!state.calm || !isFirstmateOperationalInput(e.props.text)) return next(e)
    const { Box } = $.ui.resolve(e)
    return Box({})
  })
}
