import { describe, expect, test } from 'claude-code/testing'

import { AFTER_CHANGE, BUSY, EMPTY_FLEET, ONE_WORKING } from './snapshots'
import { bandLine, drawBand, EXPECTED_ARGV, inWorld, isStock, runFleet, started, startSession } from './fixtures'

const FULLSCREEN = { isFullscreen: true, columns: 200 }
const STATUS = 'Fleet: 3 working · 3 waiting on you · 5 queued - Choose the lantern brand palette: Two…'

describe('/fleet', () => {
  test('is registered to answer at once, even while a turn is running', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })

    expect(world.commands).toHaveLength(1)
    expect(world.commands[0]).toMatchObject({ name: 'fleet', immediate: true, argumentHint: '[close|refresh|status]' })
  })

  test('opens the pane when the session is full screen, and answers with the band\'s line', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })

    const reply = await runFleet($, '', FULLSCREEN)

    expect(world.opens).toEqual([{ id: 'fm-fleet', title: 'Fleet', columns: 58 }])
    expect(reply).toBe(STATUS)
  })

  test('only answers with the line when the session is not full screen', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })

    const reply = await runFleet($, '', { isFullscreen: false, columns: 70 })

    expect(world.opens).toEqual([])
    expect(reply).toBe(STATUS)
  })

  test('close shuts the pane and says the line is back', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })
    await runFleet($, '', FULLSCREEN)

    const reply = await runFleet($, 'close', FULLSCREEN)

    expect(world.closes).toEqual(['fm-fleet'])
    expect(reply).toBe('Fleet pane closed. The line above the prompt is back.')
  })

  test('refresh reads the fleet again now and answers with what it found', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })
    world.setStdout(EMPTY_FLEET)

    const reply = await runFleet($, 'refresh')

    expect(world.runs).toHaveLength(2)
    expect(reply).toBe('Fleet: nothing under way')
  })

  test('status answers with the band\'s line and reads nothing when a reading is there', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })

    const reply = await runFleet($, 'status')

    expect(reply).toBe(STATUS)
    expect(world.runs).toHaveLength(1)
  })

  test('accepts a word in any case with spaces around it', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })

    expect(await runFleet($, '  STATUS ')).toBe(STATUS)
    expect(await runFleet($, ' Close')).toBe('Fleet pane closed. The line above the prompt is back.')
    expect(world.closes).toEqual(['fm-fleet'])
  })

  test('says how to use it for a word it does not take, and changes nothing', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })

    expect(await runFleet($, 'merge')).toBe('Usage: /fleet [close|refresh|status]')
    expect(world.runs).toHaveLength(1)
    expect(world.opens).toEqual([])
    expect(world.closes).toEqual([])
  })

  test('leaves the session whole when another plugin already owns the name', async ($, on) => {
    const world = await started($, on, { stdout: BUSY, commandTaken: true })

    expect(world.commands).toHaveLength(1)
    expect(await bandLine($, { columns: 130 })).toContain('3 working')
  })

  test('answers the state of a piece that changed since the last reading', async ($, on) => {
    const world = await started($, on, { stdout: ONE_WORKING })
    expect(await runFleet($, 'status')).toBe('Fleet: 1 working · 0 waiting on you · 0 queued')
    world.setStdout(AFTER_CHANGE)

    expect(await runFleet($, 'refresh')).toBe('Fleet: 0 working · 0 waiting on you · 0 queued')
  })
})

describe('the one command it runs', () => {
  test('is the Bearings snapshot with the work fields, from the checkout, with a timeout', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })

    expect(world.runs).toEqual([{ argv: EXPECTED_ARGV, cwd: '/work/firstmate', timeoutMs: 45_000 }])
    expect(EXPECTED_ARGV.slice(1)).toEqual(['--json', '--fields', 'work'])
  })

  test('is never anything else, whatever the session does', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })

    await runFleet($, '', FULLSCREEN)
    await runFleet($, 'refresh')
    await runFleet($, 'status')
    await runFleet($, 'close')
    await drawBand($, { isFullscreen: true })
    await world.clock.advance(12 * 60_000)

    expect(new Set(world.runs.map((run) => JSON.stringify(run.argv)))).toEqual(new Set([JSON.stringify(EXPECTED_ARGV)]))
  })

  test('keeps working after /clear by reading the fleet again', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })

    await $.classic.SessionStart({ source: 'clear' })
    await world.clock.settle()

    expect(world.runs).toHaveLength(2)
    expect(isStock(await drawBand($))).toBe(false)
    await startSession($)
  })
})
