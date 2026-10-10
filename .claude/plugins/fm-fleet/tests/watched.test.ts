import { describe, expect, test } from 'claude-code/testing'

import { drawPane, rowsOf, runFleet, started } from './fixtures'

const MINUTE = 60_000

const workingBefore = JSON.stringify({
  schema: 'fm-bearings.v1',
  generated: '2026-10-09T12:00:00Z',
  in_flight: [
    { id: 'solo-task', kind: 'ship', state: 'working', repo: 'harbor-ledger', doing: 'writing the report', title: 'Write the monthly report', since: null },
  ],
  decisions_open: [],
  landed: [],
  gates: [],
})

const blockedAfter = JSON.stringify({
  schema: 'fm-bearings.v1',
  generated: '2026-10-09T12:05:00Z',
  in_flight: [
    { id: 'solo-task', kind: 'ship', state: 'blocked', repo: 'harbor-ledger', doing: 'waiting for a login', title: 'Write the monthly report', since: null },
  ],
  decisions_open: [],
  landed: [],
  gates: [],
})

describe('how long a piece has been so', () => {
  test('shows no age for a piece that was already so when the pane started watching', async ($, on) => {
    await started($, on, { stdout: workingBefore })

    const rows = rowsOf(await drawPane($, 70))

    expect(rows).toContain('  working · Write the monthly report - writing the report')
  })

  test('shows the age of a state the pane watched a piece enter', async ($, on) => {
    const world = await started($, on, { stdout: workingBefore })
    world.setStdout(blockedAfter)

    await world.clock.advance(5 * MINUTE)
    await runFleet($, 'refresh')
    expect(rowsOf(await drawPane($, 70))).toContain('  stuck · Write the monthly report - waiting for a login · just now')

    await world.clock.advance(7 * MINUTE)
    await runFleet($, 'refresh')
    expect(rowsOf(await drawPane($, 70))).toContain('  stuck · Write the monthly report - waiting for a login · 7m')
  })

  test('shows the date a piece started when the snapshot gives one and the pane has watched nothing', async ($, on) => {
    await started($, on, { stdout: blockedAfter.replace('"since":null', '"since":"2026-10-03"') })

    expect(rowsOf(await drawPane($, 70))).toContain('  stuck · Write the monthly report - waiting for a login · Oct 3')
  })
})
