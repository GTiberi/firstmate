import { describe, expect, test } from 'claude-code/testing'

import { BUSY, ONE_WORKING } from './snapshots'
import { bandLine, endTurn, inWorld, runFleet, started, startSession } from './fixtures'

const FULLSCREEN = { isFullscreen: true, columns: 200 }
const SECOND = 1_000
const MINUTE = 60 * SECOND

describe('when the fleet is read', () => {
  test('reads once when the session starts', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })

    expect(world.runs).toHaveLength(1)
  })

  test('reads every five minutes for the band alone', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })

    await world.clock.advance(4 * MINUTE)
    expect(world.runs).toHaveLength(1)
    await world.clock.advance(MINUTE)
    expect(world.runs).toHaveLength(2)
    await world.clock.advance(5 * MINUTE)
    expect(world.runs).toHaveLength(3)
    await world.clock.advance(4 * MINUTE)
    expect(world.runs).toHaveLength(3)
  })

  test('reads every minute while the pane is open', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })
    await runFleet($, '', FULLSCREEN)
    expect(world.runs).toHaveLength(2)

    await world.clock.advance(MINUTE)
    expect(world.runs).toHaveLength(3)
    await world.clock.advance(5 * MINUTE)
    expect(world.runs).toHaveLength(8)
  })

  test('goes back to every five minutes when the pane is closed', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })
    await runFleet($, '', FULLSCREEN)
    await runFleet($, 'close', FULLSCREEN)
    const before = world.runs.length

    await world.clock.advance(4 * MINUTE)
    expect(world.runs).toHaveLength(before)
    await world.clock.advance(MINUTE)
    expect(world.runs).toHaveLength(before + 1)
  })

  test('reads when a turn ends, but not twice inside thirty seconds', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })

    await world.clock.advance(10 * SECOND)
    await endTurn($)
    await world.clock.settle()
    expect(world.runs).toHaveLength(1)

    await world.clock.advance(19 * SECOND)
    await endTurn($, 't2')
    await world.clock.settle()
    expect(world.runs).toHaveLength(1)

    await world.clock.advance(SECOND)
    await endTurn($, 't3')
    await world.clock.settle()
    expect(world.runs).toHaveLength(2)

    await world.clock.advance(5 * SECOND)
    await endTurn($, 't4')
    await world.clock.settle()
    expect(world.runs).toHaveLength(2)
  })

  test('does not read when a subagent\'s turn ends', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })

    await world.clock.advance(40 * SECOND)
    await endTurn($, 't1', 'agent-1')
    await world.clock.settle()

    expect(world.runs).toHaveLength(1)
  })

  test('counts a minute from when the last read started, however it started', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })
    await runFleet($, '', FULLSCREEN)
    await world.clock.advance(45 * SECOND)
    await endTurn($)
    await world.clock.settle()
    expect(world.runs).toHaveLength(3)

    // The next tick is 15 seconds after that read: too soon for the pane's minute.
    await world.clock.advance(15 * SECOND)
    expect(world.runs).toHaveLength(3)
    await world.clock.advance(MINUTE)
    expect(world.runs).toHaveLength(4)
  })
})

describe('never two at once', () => {
  test('a refresh, a turn end, and a tick during a read join it instead of starting another', async ($, on) => {
    const world = inWorld(on, { stdout: BUSY, hold: true })
    await startSession($)
    await world.clock.settle()
    expect(world.active.count).toBe(1)

    const refresh = runFleet($, 'refresh', FULLSCREEN)
    await world.clock.advance(40 * SECOND)
    await endTurn($)
    await world.clock.advance(MINUTE)
    await endTurn($, 't2')
    await world.clock.settle()
    expect(world.runs).toHaveLength(1)

    world.release()
    await refresh
    await world.clock.settle()

    expect(world.runs).toHaveLength(1)
    expect(world.active.max).toBe(1)
    expect(await bandLine($, { columns: 130 })).toContain('3 working')
  })

  test('a read that outlives the interval does not start a second', async ($, on) => {
    const world = inWorld(on, { stdout: BUSY, hold: true })
    await startSession($)
    const opened = runFleet($, '', FULLSCREEN)
    await world.clock.advance(10 * MINUTE)
    expect(world.runs).toHaveLength(1)
    world.release()
    await opened

    expect(world.active.max).toBe(1)
    expect(world.runs).toHaveLength(1)
  })
})

describe('a read that fails', () => {
  test('keeps the last good reading and tries again on the next tick', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })

    world.setExit(2, 'fm-bearings-snapshot: jq not found')
    await world.clock.advance(5 * MINUTE)
    expect(world.runs).toHaveLength(2)
    expect(await bandLine($, { columns: 130 })).toBe(
      'Fleet state unavailable (fm-bearings-snapshot: jq not found; last reading 5m ago)',
    )

    await world.clock.advance(MINUTE)
    expect(world.runs).toHaveLength(3)

    world.setExit(0)
    await world.clock.advance(MINUTE)
    expect(world.runs).toHaveLength(4)
    expect(await bandLine($, { columns: 130 })).toContain('3 working · 3 waiting on you · 5 queued')
  })

  test('gives up on a read that takes too long, and says so', async ($, on) => {
    const world = await started($, on, { stdout: ONE_WORKING })
    world.setRejects('process.run: timed out after 45000 ms')

    await runFleet($, 'refresh')

    expect(await bandLine($, { columns: 130 })).toBe(
      'Fleet state unavailable (the snapshot took longer than 45 seconds; last reading just now)',
    )
  })

  test('says when the snapshot command cannot be run, without the engine\'s wording', async ($, on) => {
    const world = await started($, on, { stdout: ONE_WORKING })
    world.setRejects('fm-fleet: $.process.run(/work/firstmate/bin/fm-bearings-snapshot.sh --json --fields work) failed: spawn EACCES')

    await runFleet($, 'refresh')

    expect(await bandLine($, { columns: 130 })).toBe(
      'Fleet state unavailable (the snapshot command is not runnable: permission denied; last reading just now)',
    )
  })

  test('reports a snapshot of another format, not a guess at it', async ($, on) => {
    const world = await started($, on, { stdout: ONE_WORKING })
    world.setStdout(JSON.stringify({ schema: 'fm-bearings.v2' }))

    await runFleet($, 'refresh')

    expect(await bandLine($, { columns: 130 })).toContain('unexpected snapshot format (fm-bearings.v2)')
  })
})
