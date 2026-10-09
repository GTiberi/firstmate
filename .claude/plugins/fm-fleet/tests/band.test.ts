import { describe, expect, test } from 'claude-code/testing'

import { BUSY, EMPTY_FLEET, ONE_WORKING } from './snapshots'
import {
  bandLine,
  CHECKOUT,
  drawBand,
  inWorld,
  isStock,
  rowsOf,
  runFleet,
  started,
  startSession,
  SCRIPT,
  SESSION,
  STATE_DIR,
  STOCK,
} from './fixtures'

describe('the band above the prompt', () => {
  test('is one line: how many are running, how many wait on him, how many are queued, and what waits first', async ($, on) => {
    await started($, on, { stdout: BUSY })

    expect(await bandLine($, { columns: 130 })).toBe(
      'Fleet: 3 working · 3 waiting on you · 5 queued - Choose the lantern brand palette: Two…',
    )
  })

  test('says so in a few words, on one row, when nothing is under way', async ($, on) => {
    await started($, on, { stdout: EMPTY_FLEET })

    expect(await bandLine($)).toBe('Fleet: nothing under way')
    const rows = rowsOf(await drawBand($))
    expect(rows).toEqual(['Fleet: nothing under way', 'stock'])
  })

  test('counts what is running when nothing waits on him', async ($, on) => {
    await started($, on, { stdout: ONE_WORKING })

    expect(await bandLine($)).toBe('Fleet: 1 working · 0 waiting on you · 0 queued')
  })

  test('falls back to a shorter line at narrow widths, never wider than the band', async ($, on) => {
    await started($, on, { stdout: BUSY })

    const lines: Record<number, string | undefined> = {}
    for (const columns of [130, 90, 70, 50, 40, 30, 20]) {
      lines[columns] = await bandLine($, { columns })
      // The band is the terminal's width less the five cells the engine keeps for its own mark.
      expect([...(lines[columns] ?? '')].length).toBeLessThanOrEqual(columns - 5)
    }

    expect(lines[90]).toBe('Fleet: 3 working · 3 waiting on you · 5 queued - Choose the lantern brand palette: T…')
    expect(lines[70]).toBe('Fleet: 3 working · 3 waiting on you · 5 queued - Choose the lant…')
    expect(lines[50]).toBe('Fleet: 3 working · 3 waiting on you · 5 queu…')
    expect(lines[40]).toBe('Fleet: 3 working · 3 waiting on yo…')
    expect(lines[30]).toBe('Fleet: 3 working · 3 wai…')
    expect(lines[20]).toBe('Fleet: 3 worki…')
  })

  test('leaves whatever the other mods draw in the band under its own line', async ($, on) => {
    await started($, on, { stdout: ONE_WORKING })

    const tree = await drawBand($)

    expect(rowsOf(tree)).toEqual(['Fleet: 1 working · 0 waiting on you · 0 queued', 'stock'])
    expect(STOCK.type).toBe('Text')
  })

  test('draws nothing while a survey holds the band', async ($, on) => {
    await started($, on, { stdout: BUSY })

    expect(isStock(await drawBand($, { hasSurvey: true }))).toBe(true)
  })

  test('is accepted by the terminal and the desktop app', async ($, on) => {
    await started($, on, { stdout: BUSY })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'fm-fleet',
        surface,
        component: 'AbovePrompt',
        requestId: 'band',
        viewport: { columns: 100, rows: 30 },
        props: {
          hasSurvey: false,
          isWorking: false,
          maxRows: 4,
          bodyColumns: 95,
          scroll: { offset: 0, bodyRows: 4 },
          view: {},
        },
      } as never)
      expect(await ui.find({ type: 'Text', text: /3 working/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('is drawn again when the first reading arrives after it was drawn with nothing to say', async ($, on) => {
    const world = inWorld(on, { stdout: BUSY })
    const ui = await $.ui.mount({
      plugin: 'fm-fleet',
      surface: 'terminal',
      component: 'AbovePrompt',
      requestId: 'band',
      viewport: { columns: 130, rows: 30 },
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 4,
        bodyColumns: 125,
        scroll: { offset: 0, bodyRows: 4 },
        view: {},
      },
    } as never)
    expect(await ui.find({ type: 'Text', text: /Fleet/ })).toBeUndefined()

    await startSession($)
    await world.clock.settle()

    expect(await ui.find({ type: 'Text', text: /3 working/ })).toBeDefined()
    await ui.unmount()
  })

  test('shows a reading in progress and then the fleet', async ($, on) => {
    const world = inWorld(on, { stdout: BUSY, hold: true })
    await startSession($)
    await world.clock.settle()

    expect(await bandLine($)).toBe('Fleet: reading…')
    world.release()
    await world.clock.settle()

    expect(await bandLine($, { columns: 130 })).toContain('3 working · 3 waiting on you · 5 queued')
  })
})

describe('the band and the pane', () => {
  test('opens the pane once where it docks, and yields to it while it is up', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })

    const first = await drawBand($, { isFullscreen: true })
    const second = await drawBand($, { isFullscreen: true })

    expect(world.opens).toEqual([{ id: 'fm-fleet', title: 'Fleet', columns: 58 }])
    expect(isStock(first)).toBe(true)
    expect(isStock(second)).toBe(true)
  })

  test('shows its line where the pane waits for a wider terminal, and does not ask again', async ($, on) => {
    const world = await started($, on, { stdout: BUSY, isPlaced: false })

    const line = await bandLine($, { isFullscreen: true, columns: 130 })
    await drawBand($, { isFullscreen: true })

    expect(line).toContain('3 working')
    expect(world.opens).toHaveLength(1)
  })

  test('never opens the pane where the surface is not full screen', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })

    const line = await bandLine($, { isFullscreen: false, columns: 130 })

    expect(line).toContain('3 working')
    expect(world.opens).toEqual([])
  })

  test('brings the line back when the pane is closed', async ($, on) => {
    await started($, on, { stdout: BUSY })
    await drawBand($, { isFullscreen: true })
    expect(isStock(await drawBand($, { isFullscreen: true }))).toBe(true)

    await runFleet($, 'close')

    expect(await bandLine($, { isFullscreen: true, columns: 130 })).toContain('3 working')
  })
})

describe('a read that fails', () => {
  test('says the fleet state is unavailable, with the reason, when there is no earlier reading', async ($, on) => {
    await started($, on, { stdout: 'not json' })

    expect(await bandLine($, { columns: 130 })).toBe(
      'Fleet state unavailable: the snapshot did not print JSON (no earlier reading)',
    )
  })

  test('keeps the last good reading and says how old it is', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })
    world.setExit(2, 'fm-bearings-snapshot: jq not found')

    await world.clock.advance(5 * 60_000)

    expect(await bandLine($, { columns: 130 })).toBe(
      'Fleet state unavailable (fm-bearings-snapshot: jq not found; last reading 5m ago)',
    )
  })

  test('is not a Firstmate home: quiet until asked, then says so', async ($, on) => {
    const world = await started($, on, { stdout: BUSY, files: [] })

    expect(isStock(await drawBand($))).toBe(true)
    expect(world.runs).toEqual([])

    await runFleet($, 'status')

    expect(await bandLine($)).toBe('Fleet: this folder is not a Firstmate home.')
    expect(world.runs).toEqual([])
  })

  test('is quiet in a worker\'s pane', async ($, on) => {
    const crew = await started($, on, { stdout: BUSY, env: { FM_TASK_ID: 'invented-task' } })

    expect(crew.runs).toEqual([])
    expect(crew.commands).toEqual([])
    expect(isStock(await drawBand($))).toBe(true)
  })

  test('is quiet in a print run', async ($, on) => {
    const world = inWorld(on, { stdout: BUSY })
    await $.session.start({ ...SESSION, isInteractive: false })
    await world.clock.advance(10 * 60_000)

    expect(world.runs).toEqual([])
    expect(world.commands).toEqual([])
    expect(isStock(await drawBand($))).toBe(true)
  })

  test('keeps the paths it needs in one place', () => {
    expect(SCRIPT).toBe(`${CHECKOUT}/bin/fm-bearings-snapshot.sh`)
    expect(STATE_DIR).toBe(`${CHECKOUT}/state`)
  })
})
