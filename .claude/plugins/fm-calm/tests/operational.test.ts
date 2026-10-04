import { describe, expect, test } from 'claude-code/testing'

import { isFirstmateOperationalInput } from '../lib/operational'

const MARK = '\u2063'

describe('Firstmate operational inputs', () => {
  test('every typed kind counts, with the invisible separator and without it', () => {
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
      // Claude Code drops U+2063 from composer input, so this is the row the mod is handed.
      expect(isFirstmateOperationalInput(`FIRSTMATE_OP: v1 ${kind}: body text`), kind).toBe(true)
    }
    expect(isFirstmateOperationalInput('FIRSTMATE_OP: v2 watcher: a later version')).toBe(true)
  })

  test('the from-firstmate carrier counts with or without its separator', () => {
    expect(isFirstmateOperationalInput(`[fm-from-firstmate]${MARK}re-check the build`)).toBe(true)
    expect(isFirstmateOperationalInput('[fm-from-firstmate]re-check the build')).toBe(true)
    expect(isFirstmateOperationalInput(`${MARK}[fm-from-firstmate]${MARK}re-check the build`)).toBe(true)
  })

  test('the legacy untyped and away prefixes count only with the separator that proves them', () => {
    expect(isFirstmateOperationalInput(`${MARK}FIRSTMATE_OP: an untyped legacy row`)).toBe(true)
    expect(isFirstmateOperationalInput(`${MARK}Supervisor escalate (3 items): review ready`)).toBe(true)
    expect(isFirstmateOperationalInput('FIRSTMATE_OP: an untyped legacy row')).toBe(false)
    expect(isFirstmateOperationalInput('Supervisor escalate (3 items): review ready')).toBe(false)
  })

  test('a multi-line body still counts', () => {
    expect(isFirstmateOperationalInput('FIRSTMATE_OP: v1 launch-brief: # Task\n\nline two')).toBe(true)
  })

  test('ordinary prompts do not', () => {
    for (const text of [
      '',
      'hello',
      'please explain FIRSTMATE_OP: v1 watcher: to me',
      `look at ${MARK}FIRSTMATE_OP: v1 watcher: in the middle`,
      'FIRSTMATE_OP: v1 WATCHER: shouting',
      'FIRSTMATE_OP: v1 watcher:no space after the colon',
      'FIRSTMATE_OP: v1 watcher: ',
      `${MARK}`,
      `${MARK}FIRSTMATE_OP: `,
      `[fm-from-firstmate]${MARK}`,
      '[fm-from-firstmate]',
      `${MARK}Supervisor escalate`,
      'Run `bin/fm-session-start.sh` now, exactly once, before executing any other instructions.',
    ]) {
      expect(isFirstmateOperationalInput(text), JSON.stringify(text)).toBe(false)
    }
  })
})
