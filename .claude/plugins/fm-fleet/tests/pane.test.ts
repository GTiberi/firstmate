import { describe, expect, test } from 'claude-code/testing'

import { BUSY, BUSY_IDS, EMPTY_FLEET, PR_FEES, PR_NOTES, PR_TAX, WITHOUT_WORK_FIELDS } from './snapshots'
import { drawPane, hrefsOf, PANE_ID, paneProps, rowsOf, started, textOf } from './fixtures'

const joined = (rows: string[]): string => rows.join('\n')

describe('the pane', () => {
  test('reads like the Bearings digest: what waits on him, then projects, then landed, then queued', async ($, on) => {
    await started($, on, { stdout: BUSY })

    const rows = rowsOf(await drawPane($, 80))
    const text = joined(rows)

    const order = ['Waiting on you', 'Under way', 'Recently landed', 'Queued']
    const positions = order.map((heading) => rows.indexOf(heading))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(rows[0]).toMatch(/^Fleet {2}updated just now$/)
    expect(rows[1]).toBe('3 working · 3 waiting on you · 5 queued')
    expect(text).toContain('Choose the lantern brand palette')
    expect(text).toContain('Approve the release notes wording')
    expect(text).toContain('Fix rounding in the fee table: pull request ready for your word')
  })

  test('groups the pieces by project, each with its own title and what it is doing', async ($, on) => {
    await started($, on, { stdout: BUSY })

    const rows = rowsOf(await drawPane($, 60))
    const under = rows.slice(rows.indexOf('Under way'), rows.indexOf('Recently landed'))

    expect(under.filter((row) => /^\S/.test(row) && row !== 'Under way')).toEqual([
      'harbor-ledger',
      'lantern-app',
      'tideline-docs',
      'Other work',
    ])
    const harbor = under.slice(under.indexOf('harbor-ledger'), under.indexOf('lantern-app')).join('\n')
    expect(harbor).toContain('working · Add CSV export to the ledger report')
    expect(harbor).toContain('finished · Fix rounding in the fee table')
    expect(harbor).toContain('checks pass, ready for review')
    expect(harbor).toContain('finished · Audit the ledger import paths')
    expect(harbor).toContain('report ready')
  })

  test('says every state in the captain\'s words', async ($, on) => {
    await started($, on, { stdout: BUSY })

    const text = joined(rowsOf(await drawPane($, 60)))

    for (const word of [
      'working',
      'finished',
      'stuck',
      'waiting for a decision',
      'paused on an outside wait',
      'failed',
      'state unclear',
      'waiting on another piece',
      'waiting on a date',
      'waiting for you',
      'ready to start',
    ]) {
      expect(text).toContain(word)
    }
  })

  test('never shows a task id or one of Firstmate\'s own terms', async ($, on) => {
    await started($, on, { stdout: BUSY })

    for (const columns of [30, 52, 80]) {
      const text = joined(rowsOf(await drawPane($, columns))).toLowerCase()
      // A completed scout's artifact is its report's path, which holds the id by convention.
      for (const id of BUSY_IDS.filter((name) => name !== 'docs-links')) expect(text).not.toContain(id)
      for (const term of [
        'worktree',
        'teardown',
        'needs-decision',
        'stale',
        'harness',
        'parked',
        'blocked-by',
        'captain-hold',
        'backend',
        'pipeline',
        'no-mistakes',
      ]) {
        expect(text).not.toContain(term)
      }
    }
  })

  test('shows a decision\'s address in full when one is recorded, and none when it is not', async ($, on) => {
    await started($, on, { stdout: BUSY })

    const tree = await drawPane($, 80)
    const rows = rowsOf(tree)
    const waiting = rows.slice(rows.indexOf('Waiting on you'), rows.indexOf('Under way'))

    expect(waiting.join('\n')).toContain(PR_NOTES)
    expect(waiting.join('\n')).toContain(PR_FEES)
    // The palette decision has no recorded address and gets no address row.
    const palette = waiting.findIndex((row) => row.includes('lantern brand palette'))
    expect(waiting[palette + 1]).not.toContain('https://')
    expect(hrefsOf(tree as never)).toEqual(expect.arrayContaining([PR_NOTES, PR_FEES, PR_TAX]))
  })

  test('lists the recent completions newest first, each with its artifact', async ($, on) => {
    await started($, on, { stdout: BUSY })

    const rows = rowsOf(await drawPane($, 80))
    const landed = rows.slice(rows.indexOf('Recently landed'), rows.indexOf('Queued'))

    expect(landed.filter((row) => /^ {2}\S/.test(row))).toEqual([
      '  Tax summary page · today',
      '  Fix the start-up crash · yesterday',
      '  Link audit · Oct 2',
    ])
    expect(landed).toContain(`    ${PR_TAX}`)
    expect(landed).toContain('    data/docs-links/report.md')
  })

  test('says what queued work waits for in words, never in ids', async ($, on) => {
    await started($, on, { stdout: BUSY })

    const rows = rowsOf(await drawPane($, 60))
    const queued = joined(rows.slice(rows.indexOf('Queued')))

    expect(queued).toContain('waiting on another piece · Add search to the docs site')
    expect(queued).toContain('waits for the export format')
    expect(queued).toContain('waiting on a date · Dark theme for the docs site')
    expect(queued).toContain('until Oct 15')
    expect(queued).toContain('held 21 days: waiting on a quote')
    expect(queued).toContain('ready to start · New icon set')
    // The one with a blocker note that names ids shows the note's words, not the ids.
    expect(queued).toContain('both land first')
    expect(queued).toContain("Firstmate's records for this fleet need repair.")
    expect(queued).toContain('crest: its state cannot be read right now.')
    expect(queued).toContain('Some lists are cut short.')
  })

  test('says so in four short lines when the fleet is empty', async ($, on) => {
    await started($, on, { stdout: EMPTY_FLEET })

    const rows = rowsOf(await drawPane($, 52))

    expect(rows).toEqual([
      'Fleet  updated just now',
      '0 working · 0 waiting on you · 0 queued',
      'Waiting on you',
      '  Nothing needs your action right now.',
      'Under way',
      '  Nothing is under way.',
      'Recently landed',
      '  No recent completions.',
      'Queued',
      '  Nothing is queued.',
    ])
  })

  test('notes a reading without titles when the code root predates them', async ($, on) => {
    await started($, on, { stdout: WITHOUT_WORK_FIELDS })

    const text = joined(rowsOf(await drawPane($, 70)))

    expect(text).toContain('working · writing the CSV export')
    expect(text).toContain('This reading has no titles or dates')
    expect(text).not.toContain('Oct')
  })

  test('is accepted by every surface that draws a pane', async ($, on) => {
    await started($, on, { stdout: BUSY })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'fm-fleet',
        surface,
        component: 'Pane',
        requestId: PANE_ID,
        viewport: { columns: 120, rows: 40 },
        props: paneProps(100),
      } as never)
      expect(await ui.find({ type: 'Text', text: /Waiting on you/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Add CSV export to the ledger report/ })).toBeDefined()
      expect(await ui.find({ type: 'Link', text: /pull\/42/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('draws a warning tone for what waits on him and a dim one for what has landed', async ($, on) => {
    await started($, on, { stdout: BUSY })

    const ui = await $.ui.mount({
      plugin: 'fm-fleet',
      surface: 'terminal',
      component: 'Pane',
      requestId: PANE_ID,
      viewport: { columns: 120, rows: 40 },
      props: paneProps(60),
    } as never)

    const toneOf = async (pattern: RegExp): Promise<Record<string, unknown>[]> =>
      (await ui.findAll({ type: 'Text', text: pattern })).map((found) => found.props)
    const palette = await toneOf(/^Choose the lantern brand palette/)
    const tax = await toneOf(/^Tax summary page/)
    await ui.unmount()

    expect(palette.some((props) => props.color === 'warning')).toBe(true)
    expect(tax.some((props) => props.dimColor === true)).toBe(true)
  })
})

describe('the width', () => {
  test('cuts every row to the pane and keeps every address whole behind its link', async ($, on) => {
    await started($, on, { stdout: BUSY })

    for (const columns of [14, 20, 28, 36, 52, 80, 120]) {
      const tree = await drawPane($, columns)
      for (const row of rowsOf(tree)) {
        expect([...row].length).toBeLessThanOrEqual(columns)
      }
      const hrefs = hrefsOf(tree as never)
      expect(hrefs).toEqual(expect.arrayContaining([PR_FEES, PR_NOTES, PR_TAX]))
    }
  })

  test('cuts a long title with an ellipsis and shows a short one whole', async ($, on) => {
    await started($, on, { stdout: BUSY })

    const narrow = joined(rowsOf(await drawPane($, 36)))
    const wide = joined(rowsOf(await drawPane($, 120)))

    expect(narrow).toContain('…')
    expect(narrow).not.toContain('Add CSV export to the ledger report')
    expect(wide).toContain('Add CSV export to the ledger report')
    expect(wide).toContain('Passwordless sign in for the lantern app')
  })

  test('keeps both ends of an address that does not fit', async ($, on) => {
    await started($, on, { stdout: BUSY })

    const rows = rowsOf(await drawPane($, 30))
    const address = rows.find((row) => row.includes('/pull/42'))

    expect(address).toBeDefined()
    expect(address).toContain('https://')
    expect(address).toContain('…')
    expect(address?.endsWith('/pull/42')).toBe(true)
  })

  test('draws nothing wider than the pane even for a title with wide characters', async ($, on) => {
    const wide = JSON.stringify({
      schema: 'fm-bearings.v1',
      generated: '2026-10-09T12:00:00Z',
      in_flight: [
        { id: 'wide-one', kind: 'ship', state: 'working', repo: 'harbor-ledger', doing: '', title: '日本語のタイトルがとても長い仕事の名前です', since: null },
      ],
      decisions_open: [],
      landed: [],
      gates: [],
    })
    await started($, on, { stdout: wide })

    const row = rowsOf(await drawPane($, 30)).find((line) => line.includes('working')) ?? ''

    expect(textOf(row)).toContain('…')
    // Each wide character takes two cells.
    const cells = [...row].reduce((total, char) => total + ((char.codePointAt(0) ?? 0) > 0x2e80 ? 2 : 1), 0)
    expect(cells).toBeLessThanOrEqual(30)
  })
})
