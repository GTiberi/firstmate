import { describe, expect, test } from 'claude-code/testing'

import {
  ansiOf,
  drawSpinner,
  drawUserMessage,
  endTurn,
  inWorld,
  isNothing,
  isStock,
  OPERATIONAL,
  OPERATIONAL_WITH_MARK,
  PREFERENCE,
  runCalm,
  SPINNER_PROPS,
  startSession,
  startTurn,
  textOf,
  TOOL_ROWS,
  TOOL_USE_PROPS,
} from './fixtures'
import {
  CALM_WORKING_SHIP_TICK_MS,
  CALM_WORKING_SHIP_TICKS_PER_MOVE,
  createCalmWorkingShipAnimation,
} from '../lib/working-ship'

const ON = { files: { [PREFERENCE]: 'on\n' } }
const MOVE_MS = CALM_WORKING_SHIP_TICK_MS * CALM_WORKING_SHIP_TICKS_PER_MOVE
const HULL = '\\__/'

const hullColumnOf = (rows: string[]): number => rows[1]?.indexOf('\u001b[33m') ?? -1

/** The boat a fresh animation draws after `ticks` scheduler ticks at `columns`. */
function expectedAfter(ticks: number, columns: number): string[] {
  const animation = createCalmWorkingShipAnimation()
  animation.render(columns)
  for (let tick = 0; tick < ticks; tick += 1) {
    animation.tick()
    animation.render(columns)
  }
  return animation.render(columns).map((row) => row.map((run) => run.text).join(''))
}

const plain = (rows: string[]): string[] => rows.map((row) => row.replace(/\u001b\[\d+m/g, ''))

describe('the spinner', () => {
  test('stays the stock spinner while Calm is off', async ($, on) => {
    inWorld(on)
    await startSession($)
    await startTurn($)

    expect(isStock(await drawSpinner($))).toBe(true)
  })

  test('stays the stock spinner while Calm is on but no turn is running', async ($, on) => {
    inWorld(on, ON)
    await startSession($)

    expect(isStock(await drawSpinner($))).toBe(true)
  })

  test('is the two-row boat alone while Calm is on and a turn is running', async ($, on) => {
    inWorld(on, ON)
    await startSession($)
    await startTurn($)

    const tree = await drawSpinner($)

    expect(isStock(tree)).toBe(false)
    const rows = ansiOf(tree)
    expect(rows).toHaveLength(2)
    expect(plain(rows)[0]).toBe(' <|')
    expect(plain(rows)[1]).toBe(`${HULL}${'~~-~'.repeat(9)}`)
    expect(textOf(tree)).not.toContain('Sauteing')
    expect(textOf(tree)).not.toContain('…')
  })

  test('draws the water in standard ANSI blue and the whole boat in standard ANSI yellow', async ($, on) => {
    inWorld(on, ON)
    await startSession($)
    await startTurn($)

    const rows = ansiOf(await drawSpinner($))

    expect(rows[0]).toBe(' \u001b[33m<|\u001b[39m')
    expect(rows[1]?.startsWith(`\u001b[33m${HULL}\u001b[39m\u001b[34m`)).toBe(true)
    const colors = (rows.join('').match(/\u001b\[\d+m/g) ?? []).filter((code) => code !== '\u001b[39m')
    expect(new Set(colors)).toEqual(new Set(['\u001b[33m', '\u001b[34m']))
  })

  test('is accepted by every surface that draws a spinner, in its own colour names', async ($, on) => {
    inWorld(on, ON)
    await startSession($)
    await startTurn($)
    const viewport = { columns: 40, rows: 24 }

    const colorsOn = async (surface: 'terminal' | 'desktop'): Promise<string[]> => {
      const ui = await $.ui.mount({
        plugin: 'fm-calm',
        surface,
        component: 'Spinner',
        viewport,
        props: SPINNER_PROPS,
      })
      const runs = await ui.findAll({ type: 'Text' })
      await ui.unmount()
      return [...new Set(runs.map((run) => String(run.props.color)))].sort()
    }

    // The terminal asks for entries 3 and 4 of its own palette, which is what SGR 33 and 34 select;
    // a named colour would be resolved through Claude Code's theme instead.
    expect(await colorsOn('terminal')).toEqual(['ansi256(3)', 'ansi256(4)', 'undefined'])
    expect(await colorsOn('desktop')).toEqual(['blue', 'undefined', 'yellow'])
  })

  test('fills the usable width with water and never wraps', async ($, on) => {
    inWorld(on, ON)
    await startSession($)
    await startTurn($)

    for (const columns of [12, 40, 79, 132]) {
      const rows = plain(ansiOf(await drawSpinner($, columns)))
      expect(rows[1]).toHaveLength(columns)
      expect((rows[0] ?? '').length).toBeLessThanOrEqual(columns)
    }
  })

  test('moves the boat one column every 880 ms and ripples the water faster', async ($, on) => {
    const world = inWorld(on, ON)
    await startSession($)
    await startTurn($)
    const start = ansiOf(await drawSpinner($))

    await world.clock.advance(CALM_WORKING_SHIP_TICK_MS)
    const rippled = ansiOf(await drawSpinner($))
    expect(hullColumnOf(rippled)).toBe(hullColumnOf(start))
    expect(rippled[1]).not.toBe(start[1])

    await world.clock.advance(MOVE_MS - CALM_WORKING_SHIP_TICK_MS - 1)
    expect(hullColumnOf(ansiOf(await drawSpinner($)))).toBe(hullColumnOf(start))

    await world.clock.advance(1)
    const stepped = ansiOf(await drawSpinner($))
    expect(plain(stepped)[1]?.indexOf(HULL)).toBe(1)
    expect(plain(stepped)).toEqual(expectedAfter(CALM_WORKING_SHIP_TICKS_PER_MOVE, 40))
  })

  test('turns at the edge on the exact frame the boat arrives there, in both directions', async ($, on) => {
    const world = inWorld(on, ON)
    await startSession($)
    await startTurn($)
    const columns = 8
    const span = columns - HULL.length
    const sails: string[] = []

    for (let step = 0; step <= span * 2; step += 1) {
      const rows = plain(ansiOf(await drawSpinner($, columns)))
      sails.push(`${rows[1]?.indexOf(HULL)}:${rows[0]?.trim()}`)
      await world.clock.advance(MOVE_MS)
    }

    expect(sails).toEqual([
      '0:<|', '1:<|', '2:<|', '3:<|', '4:|>', '3:|>', '2:|>', '1:|>', '0:<|',
    ])
  })

  test('stays inside the redraw throttle of ten a second', async ($, on) => {
    const world = inWorld(on, ON)
    await startSession($)
    await startTurn($)
    const before = world.invalidations.count

    await world.clock.advance(10_000)

    const perSecond = (world.invalidations.count - before) / 10
    expect(perSecond).toBeGreaterThan(0)
    expect(perSecond).toBeLessThanOrEqual(10)
    expect(CALM_WORKING_SHIP_TICK_MS).toBeGreaterThanOrEqual(100)
  })

  test('draws nothing of its own and asks for no redraw once the run settles', async ($, on) => {
    const world = inWorld(on, ON)
    await startSession($)
    await startTurn($)
    await drawSpinner($)
    await world.clock.advance(MOVE_MS)
    await endTurn($)
    const settled = world.invalidations.count

    await world.clock.advance(60_000)

    expect(world.invalidations.count).toBe(settled)
    expect(isStock(await drawSpinner($))).toBe(true)
  })

  test('starts no timer until a turn runs with Calm on', async ($, on) => {
    const world = inWorld(on)
    await startSession($)
    const idle = world.invalidations.count
    await world.clock.advance(5_000)
    expect(world.invalidations.count).toBe(idle)

    await startTurn($)
    await world.clock.advance(5_000)
    expect(world.invalidations.count).toBe(idle)
  })

  test('hidden elapsed time never advances the boat: the next run resumes where it stopped', async ($, on) => {
    const world = inWorld(on, ON)
    await startSession($)
    await startTurn($)
    await drawSpinner($)
    await world.clock.advance(MOVE_MS * 3)
    const stopped = plain(ansiOf(await drawSpinner($)))
    await endTurn($)

    await world.clock.advance(60 * 60 * 1000)
    await startTurn($, 't2')

    expect(plain(ansiOf(await drawSpinner($)))).toEqual(stopped)
    expect(stopped[1]?.indexOf(HULL)).toBe(3)
  })

  test('a resume keeps the direction the boat was travelling', async ($, on) => {
    const world = inWorld(on, ON)
    await startSession($)
    await startTurn($)
    const columns = 8
    await drawSpinner($, columns)
    await world.clock.advance(MOVE_MS * 6)
    const heading = plain(ansiOf(await drawSpinner($, columns)))
    expect(heading[0]?.trim()).toBe('|>')
    await endTurn($)

    await startTurn($, 't2')

    expect(plain(ansiOf(await drawSpinner($, columns)))).toEqual(heading)
  })

  test('a fresh session starts the boat at the initial position', async ($, on) => {
    const world = inWorld(on, ON)
    await startSession($)
    await startTurn($)
    await drawSpinner($)
    await world.clock.advance(MOVE_MS * 3)
    await endTurn($)

    await $.classic.SessionStart({ source: 'clear' })
    await startTurn($, 't2')

    const rows = plain(ansiOf(await drawSpinner($)))
    expect(rows[0]).toBe(' <|')
    expect(rows[1]?.indexOf(HULL)).toBe(0)
  })

  test('a compaction stays inside the session and keeps the boat', async ($, on) => {
    const world = inWorld(on, ON)
    await startSession($)
    await startTurn($)
    await drawSpinner($)
    await world.clock.advance(MOVE_MS * 2)
    const stopped = plain(ansiOf(await drawSpinner($, 40)))
    await endTurn($)

    await $.classic.SessionStart({ source: 'compact' })
    await startTurn($, 't2')

    expect(plain(ansiOf(await drawSpinner($)))).toEqual(stopped)
  })

  test('a subagent finishing does not end the main run', async ($, on) => {
    const world = inWorld(on, ON)
    await startSession($)
    await startTurn($)

    await endTurn($, 'sub-1', 'agent-1')
    const before = world.invalidations.count
    await world.clock.advance(MOVE_MS)

    expect(world.invalidations.count).toBeGreaterThan(before)
    expect(isStock(await drawSpinner($))).toBe(false)
  })

  test('resizing reflows the boat without wrapping and clamps it without turning it around', async ($, on) => {
    const world = inWorld(on, ON)
    await startSession($)
    await startTurn($)
    await drawSpinner($, 40)
    await world.clock.advance(MOVE_MS * 10)
    expect(plain(ansiOf(await drawSpinner($, 40)))[1]?.indexOf(HULL)).toBe(10)

    const narrow = plain(ansiOf(await drawSpinner($, 8)))

    expect(narrow[1]).toHaveLength(8)
    expect(narrow[1]?.indexOf(HULL)).toBe(4)
    expect(narrow[0]?.trim()).toBe('|>')

    const wide = plain(ansiOf(await drawSpinner($, 60)))
    expect(wide[1]).toHaveLength(60)
    expect(wide[0]?.trim()).toBe('|>')
  })

  test('falls back to a smaller deterministic sprite in a very narrow terminal', async ($, on) => {
    inWorld(on, ON)
    await startSession($)
    await startTurn($)

    expect(plain(ansiOf(await drawSpinner($, 3)))).toEqual(['<|-'])
    expect(plain(ansiOf(await drawSpinner($, 1)))).toEqual(['~'])
    expect(plain(ansiOf(await drawSpinner($, 3)))).toEqual(plain(ansiOf(await drawSpinner($, 3))))
  })

  test('draws for a surface that has not measured its window yet', async ($, on) => {
    inWorld(on, ON)
    await startSession($)
    await startTurn($)

    const tree = await $.ui.render({
      surface: 'terminal',
      component: 'Spinner',
      requestId: 'main',
      props: { word: 'Sauteing', message: null, suffix: '…', mode: 'requesting' },
    })

    expect(plain(ansiOf(tree))[1]).toHaveLength(80)
  })
})

describe('toggling while a run is under way', () => {
  test('turning Calm on starts the boat at once and off restores the stock spinner at once', async ($, on) => {
    const world = inWorld(on)
    await startSession($)
    await startTurn($)
    expect(isStock(await drawSpinner($))).toBe(true)

    await runCalm($, 'on')
    expect(isStock(await drawSpinner($))).toBe(false)
    const redraws = world.invalidations.count
    await world.clock.advance(MOVE_MS)
    expect(world.invalidations.count).toBeGreaterThan(redraws)

    await runCalm($, 'off')
    expect(isStock(await drawSpinner($))).toBe(true)
    const settled = world.invalidations.count
    await world.clock.advance(60_000)
    expect(world.invalidations.count).toBe(settled)
  })

  test('asks the engine to redraw every hooked site on each toggle', async ($, on) => {
    const world = inWorld(on)
    await startSession($)
    const before = world.invalidations.count

    await runCalm($, 'on')
    const afterOn = world.invalidations.count
    await runCalm($, 'off')

    expect(afterOn).toBeGreaterThan(before)
    expect(world.invalidations.count).toBeGreaterThan(afterOn)
  })
})

describe('hidden chrome', () => {
  test('tool rows, tool results, tool groups, and tool progress draw nothing while Calm is on', async ($, on) => {
    inWorld(on, ON)
    await startSession($)

    for (const row of Object.values(TOOL_ROWS)) {
      expect(isNothing(await $.ui.render(row)), row.component).toBe(true)
    }
  })

  test('the empty drawing is accepted by every surface that draws these rows', async ($, on) => {
    inWorld(on, ON)
    await startSession($)

    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      const tool = await $.ui.mount({
        plugin: 'fm-calm',
        surface,
        component: 'ToolUse',
        requestId: 'toolu_1',
        props: TOOL_USE_PROPS,
      })
      expect(await tool.drawn(), `ToolUse on ${surface}`).toMatchObject({ type: 'Box' })
      expect(await tool.find({ type: 'Text' }), `ToolUse on ${surface}`).toBeUndefined()
      await tool.unmount()

      const user = await $.ui.mount({
        plugin: 'fm-calm',
        surface,
        component: 'UserMessage',
        requestId: 'msg_1',
        props: { text: OPERATIONAL, origin: { kind: 'composer' }, isExpanded: false },
      })
      expect(await user.find({ type: 'Text' }), `UserMessage on ${surface}`).toBeUndefined()
      await user.unmount()
    }
  })

  test('tool chrome is the stock drawing while Calm is off', async ($, on) => {
    inWorld(on)
    await startSession($)

    for (const row of Object.values(TOOL_ROWS)) {
      expect(isStock(await $.ui.render(row)), row.component).toBe(true)
    }
  })

  test('tool chrome comes back the moment Calm is turned off', async ($, on) => {
    inWorld(on, ON)
    await startSession($)
    expect(isNothing(await $.ui.render(TOOL_ROWS.ToolUse))).toBe(true)

    await runCalm($, 'off')

    expect(isStock(await $.ui.render(TOOL_ROWS.ToolUse))).toBe(true)
  })

  test('an operational user row draws nothing while Calm is on', async ($, on) => {
    inWorld(on, ON)
    await startSession($)

    for (const text of [
      OPERATIONAL,
      OPERATIONAL_WITH_MARK,
      '[fm-from-firstmate]please re-check the build',
      '[fm-from-firstmate]\u2063please re-check the build',
      '\u2063Supervisor escalate (2 items): review ready',
    ]) {
      expect(isNothing(await drawUserMessage($, text)), text).toBe(true)
    }
  })

  test('an ordinary user row stays as drawn', async ($, on) => {
    inWorld(on, ON)
    await startSession($)

    for (const text of [
      'please run the tests',
      'explain FIRSTMATE_OP: v1 watcher: to me',
      'the prefix \u2063FIRSTMATE_OP: in the middle of a sentence',
      'FIRSTMATE_OP: v1 WATCHER: shouting',
      'FIRSTMATE_OP: ',
      '\u2063FIRSTMATE_OP: ',
      '',
    ]) {
      expect(isStock(await drawUserMessage($, text)), text).toBe(true)
    }
  })

  test('an operational user row is drawn as always while Calm is off', async ($, on) => {
    inWorld(on)
    await startSession($)

    expect(isStock(await drawUserMessage($, OPERATIONAL))).toBe(true)
  })

  test('sites the mod does not own go straight through, permission and question dialogs included', async ($, on) => {
    inWorld(on, ON)
    await startSession($)
    await startTurn($)

    const untouched = [
      {
        surface: 'terminal',
        component: 'AssistantMessage',
        requestId: 'msg_2',
        props: { text: 'Let me look at that.', isFirstOfReply: true },
      },
      {
        surface: 'terminal',
        component: 'CommandOutput',
        requestId: 'msg_3',
        props: { command: 'calm', args: '', text: 'Calm is on.', isErrored: false },
      },
      {
        surface: 'terminal',
        component: 'TurnDuration',
        requestId: 'msg_4',
        props: { word: 'Baked', durationMs: 3000 },
      },
    ] as const

    for (const row of untouched) {
      expect(isStock(await $.ui.render(row)), row.component).toBe(true)
    }

    // The question dialog is the engine's alone: the mod hooks no part of it.
    const dialog = await $.ui.render({
      surface: 'terminal',
      component: 'AskUserQuestion',
      requestId: 'toolu_9',
      props: { tool: 'AskUserQuestion', questions: [] },
    })
    expect(dialog.type).toBe('engine')
  })
})
