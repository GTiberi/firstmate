import { describe, expect, test } from 'claude-code/testing'

import { parseSnapshot } from '../lib/snapshot'
import { BUSY, BUSY_DATA, EMPTY_FLEET, json, PR_FEES, WITHOUT_WORK_FIELDS } from './snapshots'

const parsed = (output: string) => {
  const result = parseSnapshot(output)
  if (!result.isOk) throw new Error(result.reason)
  return result.reading
}

describe('reading the snapshot', () => {
  test('keeps the rows the pane shows and nothing else', () => {
    const reading = parsed(BUSY)

    expect(reading.work).toHaveLength(10)
    expect(reading.work[0]).toEqual({
      id: 'ledger-export',
      kind: 'ship',
      state: 'working',
      repo: 'harbor-ledger',
      doing: 'harness busy (claude-hook)',
      title: 'Add CSV export to the ledger report',
      since: '2026-10-08',
    })
    expect(reading.decisions).toHaveLength(2)
    expect(reading.landed).toHaveLength(3)
    expect(reading.gates).toHaveLength(6)
    expect(reading.prs).toEqual({
      'ledger-fees': PR_FEES,
      'release-notes': 'https://github.com/invented-org/tideline-docs/pull/9',
    })
    expect(reading.hasWorkFields).toBe(true)
    expect(reading.isCapped).toBe(true)
  })

  test('reads the placeholders as nothing', () => {
    const reading = parsed(BUSY)
    const icons = reading.gates.find((gate) => gate.id === 'lantern-icons')

    expect(icons).toEqual({ id: 'lantern-icons', title: 'New icon set', blockedBy: [], reason: '', repo: 'lantern-app' })
    expect(reading.gates.find((gate) => gate.id === 'tag-release')?.blockedBy).toEqual([
      'ledger-export',
      'lantern-sync',
    ])
    expect(reading.work.find((row) => row.id === 'crest/crest-api')?.title).toBeNull()
  })

  test('reads an empty fleet', () => {
    const reading = parsed(EMPTY_FLEET)

    expect(reading.work).toEqual([])
    expect(reading.prs).toEqual({})
    expect(reading.isCapped).toBe(false)
    expect(reading.hasWorkFields).toBe(true)
  })

  test('notices a snapshot from a code root that predates the work fields', () => {
    const reading = parsed(WITHOUT_WORK_FIELDS)

    expect(reading.hasWorkFields).toBe(false)
    expect(reading.work[0]?.title).toBeNull()
    expect(reading.work[0]?.since).toBeNull()
    expect(reading.landed[0]?.date).toBeNull()
  })

  test('drops a row with no id and an address that is not a web address', () => {
    const reading = parsed(
      json({
        ...BUSY_DATA,
        in_flight: [{ kind: 'ship', state: 'working' }, { id: ' ', state: 'working' }, 'nonsense'],
        recorded_prs: [{ id: 'a', url: 'javascript:alert(1)' }, { id: 'b', url: 'https://example.org/pull/1' }, { url: 'x' }],
      }),
    )

    expect(reading.work).toEqual([])
    expect(reading.prs).toEqual({ b: 'https://example.org/pull/1' })
  })

  test('refuses what is not the snapshot, with the reason', () => {
    const reason = (output: string): string | undefined => {
      const result = parseSnapshot(output)
      return result.isOk ? undefined : result.reason
    }

    expect(reason('')).toBe('the snapshot did not print JSON')
    expect(reason('not json')).toBe('the snapshot did not print JSON')
    expect(reason('[]')).toBe('the snapshot did not print a JSON object')
    expect(reason('{}')).toBe('unexpected snapshot format (no schema)')
    expect(reason(json({ schema: 'fm-bearings.v2' }))).toBe('unexpected snapshot format (fm-bearings.v2)')
    expect(reason(json({ ...BUSY_DATA, gates: undefined }))).toBe('the snapshot has no gates list')
    expect(reason(json({ ...BUSY_DATA, in_flight: 'many' }))).toBe('the snapshot has no in_flight list')
  })
})
