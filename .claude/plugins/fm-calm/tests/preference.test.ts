import { describe, expect, test } from 'claude-code/testing'

import {
  calmPreferencePathOf,
  failureReasonOf,
  joinPath,
  parseCalmCommand,
  parseCalmPreference,
  serializeCalmPreference,
  temporaryPathOf,
} from '../lib/preference'

const NONE = {
  fmHome: undefined,
  fmRootOverride: undefined,
  fmConfigOverride: undefined,
  checkoutRoot: undefined,
}

describe('the file format', () => {
  test('writes on or off followed by one newline', () => {
    expect(serializeCalmPreference(true)).toBe('on\n')
    expect(serializeCalmPreference(false)).toBe('off\n')
  })

  test('reads on and the legacy max as on and everything else as off', () => {
    expect(parseCalmPreference('on\n')).toBe(true)
    expect(parseCalmPreference('max\n')).toBe(true)
    expect(parseCalmPreference('  on  ')).toBe(true)
    for (const text of ['off\n', '', '\n', 'ON', 'true', '1', 'on off', 'maximum']) {
      expect(parseCalmPreference(text), JSON.stringify(text)).toBe(false)
    }
  })
})

describe('the command words', () => {
  test('no argument toggles; on, off, and status are explicit; anything else is unknown', () => {
    expect(parseCalmCommand('')).toBe('toggle')
    expect(parseCalmCommand('  ')).toBe('toggle')
    expect(parseCalmCommand('on')).toBe('on')
    expect(parseCalmCommand(' Off ')).toBe('off')
    expect(parseCalmCommand('STATUS')).toBe('status')
    expect(parseCalmCommand('max')).toBeUndefined()
    expect(parseCalmCommand('on please')).toBeUndefined()
  })
})

describe('the home', () => {
  test('FM_HOME, then FM_ROOT_OVERRIDE, then the checkout', () => {
    expect(calmPreferencePathOf({ ...NONE, fmHome: '/h', fmRootOverride: '/r', checkoutRoot: '/c' })).toBe(
      '/h/config/calm',
    )
    expect(calmPreferencePathOf({ ...NONE, fmRootOverride: '/r', checkoutRoot: '/c' })).toBe('/r/config/calm')
    expect(calmPreferencePathOf({ ...NONE, checkoutRoot: '/c/' })).toBe('/c/config/calm')
  })

  test('FM_CONFIG_OVERRIDE names the config directory and needs no home', () => {
    expect(calmPreferencePathOf({ ...NONE, fmConfigOverride: '/cfg' })).toBe('/cfg/calm')
    expect(calmPreferencePathOf({ ...NONE, fmHome: '/h', fmConfigOverride: '/cfg/' })).toBe('/cfg/calm')
  })

  test('no home at all resolves to no file', () => {
    expect(calmPreferencePathOf(NONE)).toBeUndefined()
    expect(calmPreferencePathOf({ ...NONE, fmHome: '', fmRootOverride: '' })).toBeUndefined()
  })

  test('joins without doubling slashes', () => {
    expect(joinPath('/a/b//', 'c', 'd')).toBe('/a/b/c/d')
  })

  test('a temporary file is a sibling of the file it will replace', () => {
    expect(temporaryPathOf('/h/config/calm', 'abc1')).toBe('/h/config/calm.abc1.tmp')
  })
})

describe('a failed save', () => {
  test('keeps only the why, on one line', () => {
    expect(failureReasonOf('fm-calm: $.fs.write: EACCES: permission denied')).toBe('EACCES: permission denied')
    expect(failureReasonOf('mv: cannot move\nsecond line')).toBe('mv: cannot move')
    expect(failureReasonOf('')).toBe('unknown error')
    expect(failureReasonOf('x'.repeat(300))).toHaveLength(120)
  })
})
