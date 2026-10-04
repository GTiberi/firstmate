import { describe, expect, test } from 'claude-code/testing'

import { isFirstmateOperationalInput } from '../lib/operational'

const MARK = '\u2063'

describe('Firstmate operational inputs', () => {
  test('every typed kind carries the permanent operational prefix', () => {
    for (const kind of [
      'session-start',
      'watcher',
      'turn-end-guard',
      'away-supervisor',
      'launch-brief',
      'branch-outcome',
      'a-kind-added-later',
    ]) {
      expect(isFirstmateOperationalInput(`${MARK}FIRSTMATE_OP: v1 ${kind}: body text`), kind).toBe(true)
    }
  })

  test('the from-firstmate carrier and the legacy untyped and away prefixes count', () => {
    expect(isFirstmateOperationalInput(`[fm-from-firstmate]${MARK}re-check the build`)).toBe(true)
    expect(isFirstmateOperationalInput(`${MARK}FIRSTMATE_OP: an untyped legacy row`)).toBe(true)
    expect(isFirstmateOperationalInput(`${MARK}Supervisor escalate (3 items): review ready`)).toBe(true)
  })

  test('a multi-line body still counts', () => {
    expect(isFirstmateOperationalInput(`${MARK}FIRSTMATE_OP: v1 launch-brief: # Task\n\nline two`)).toBe(true)
  })

  test('ordinary prompts do not', () => {
    for (const text of [
      '',
      'hello',
      'FIRSTMATE_OP: v1 watcher: no invisible separator',
      `look at ${MARK}FIRSTMATE_OP: in the middle`,
      `${MARK}`,
      `${MARK}FIRSTMATE_OP: `,
      `[fm-from-firstmate]${MARK}`,
      '[fm-from-firstmate] without the separator',
      `${MARK}Supervisor escalate`,
      'Run `bin/fm-session-start.sh` now, exactly once, before executing any other instructions.',
    ]) {
      expect(isFirstmateOperationalInput(text), JSON.stringify(text)).toBe(false)
    }
  })
})
