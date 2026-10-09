import { describe, expect, test } from 'claude-code/testing'

import {
  ageWords,
  agoWords,
  cut,
  cutAlways,
  cutMiddle,
  firstWords,
  plainDoing,
  shortDate,
  widthOf,
  workState,
} from '../lib/words'
import { failureReasonOf, parseFleetCommand, startFailureReason } from '../lib/command'

describe('state words', () => {
  test('say each state in the captain\'s words', () => {
    expect(workState('working').word).toBe('working')
    expect(workState('parked').word).toBe('waiting for a decision')
    expect(workState('blocked').word).toBe('stuck')
    expect(workState('paused').word).toBe('paused on an outside wait')
    expect(workState('done').word).toBe('finished')
    expect(workState('failed').word).toBe('failed')
    expect(workState('unknown').word).toBe('state unclear')
    expect(workState('something-new').word).toBe('state unclear')
  })

  test('put what needs attention first in a project', () => {
    const order = ['working', 'done', 'blocked', 'paused', 'failed', 'parked', 'unknown']
    const ranked = [...order].sort((a, b) => workState(a).rank - workState(b).rank)
    expect(ranked.slice(0, 3).sort()).toEqual(['blocked', 'failed', 'parked'])
    expect(ranked[ranked.length - 1]).toBe('done')
  })
})

describe('what a piece is doing', () => {
  test('says nothing for a busy worker, because the state word already says it', () => {
    expect(plainDoing('harness busy (claude-hook)')).toBe('')
    expect(plainDoing('')).toBe('')
  })

  test('puts Firstmate\'s own terms into plain words', () => {
    expect(plainDoing('validating (running)')).toBe('checking the change')
    expect(plainDoing('ci running')).toBe('waiting on the checks')
    expect(plainDoing('parked at review: 2 finding(s) (ask-user: authority decision)')).toBe(
      'a review finding needs a decision',
    )
    expect(plainDoing('checks green: PR ready for review')).toBe('checks pass, ready for review')
    expect(plainDoing('PR https://github.com/invented-org/harbor-ledger/pull/42 checks green')).toBe(
      'checks pass, ready for review',
    )
    expect(plainDoing('run failed')).toBe('the checks did not pass')
    expect(plainDoing('backend target gone: firstmate:fm-x')).toBe('lost contact with the worker')
  })

  test('keeps a worker\'s own words and drops a line it cannot put plainly', () => {
    expect(plainDoing('writing the CSV export')).toBe('writing the CSV export')
    expect(plainDoing('rebasing the worktree onto main')).toBe('')
    expect(plainDoing('  waiting   for a test account ')).toBe('waiting for a test account')
  })
})

describe('time', () => {
  test('says a span in one unit', () => {
    expect(ageWords(0)).toBe('just now')
    expect(ageWords(59_000)).toBe('just now')
    expect(ageWords(60_000)).toBe('1m')
    expect(ageWords(59 * 60_000)).toBe('59m')
    expect(ageWords(3 * 3_600_000)).toBe('3h')
    expect(ageWords(47 * 3_600_000)).toBe('47h')
    expect(ageWords(3 * 86_400_000)).toBe('3d')
    expect(ageWords(-5)).toBe('just now')
    expect(agoWords(5 * 60_000)).toBe('5m ago')
    expect(agoWords(1_000)).toBe('just now')
  })

  test('says a date short', () => {
    expect(shortDate('2026-10-15')).toBe('Oct 15')
    expect(shortDate('2026-01-02T10:00:00Z')).toBe('Jan 2')
    expect(shortDate('soon')).toBe('soon')
    expect(shortDate('2026-13-01')).toBe('2026-13-01')
  })
})

describe('width', () => {
  test('counts a wide character as two cells and a combining mark as none', () => {
    expect(widthOf('abc')).toBe(3)
    expect(widthOf('日本')).toBe(4)
    expect(widthOf('é')).toBe(1)
    expect(widthOf('…')).toBe(1)
  })

  test('cuts at the width with an ellipsis, and leaves what fits alone', () => {
    expect(cut('hello', 5)).toBe('hello')
    expect(cut('hello world', 8)).toBe('hello w…')
    expect(cut('hello', 1)).toBe('…')
    expect(cut('hello', 0)).toBe('')
    expect(cut('日本語の名前', 7)).toBe('日本語…')
    expect(cutAlways('hello', 5)).toBe('hell…')
  })

  test('cuts an address in the middle so both ends survive', () => {
    const url = 'https://github.com/invented-org/harbor-ledger/pull/42'
    const cutUrl = cutMiddle(url, 30)
    expect(widthOf(cutUrl)).toBe(30)
    expect(cutUrl.startsWith('https://github.')).toBe(true)
    expect(cutUrl.endsWith('ledger/pull/42')).toBe(true)
    expect(cutMiddle(url, 99)).toBe(url)
    expect(cutMiddle(url, 3)).toBe('ht…')
  })

  test('keeps the first words of a long line', () => {
    expect(firstWords('Choose the lantern brand palette: Two palettes are ready', 40)).toBe(
      'Choose the lantern brand palette: Two…',
    )
    expect(firstWords('short line', 40)).toBe('short line')
    expect(firstWords('unbrokenwordthatislongerthanthelimit', 12)).toBe('unbrokenwor…')
  })
})

describe('the command words', () => {
  test('take close, refresh, and status, and nothing else', () => {
    expect(parseFleetCommand('')).toBe('open')
    expect(parseFleetCommand('  ')).toBe('open')
    expect(parseFleetCommand('close')).toBe('close')
    expect(parseFleetCommand('REFRESH')).toBe('refresh')
    expect(parseFleetCommand(' Status ')).toBe('status')
    expect(parseFleetCommand('merge')).toBeUndefined()
    expect(parseFleetCommand('close now')).toBeUndefined()
  })

  test('say why the snapshot could not run without the engine\'s own wording', () => {
    expect(startFailureReason('fm-fleet: $.process.run(/x/y.sh) timed out after 45000 ms', 45)).toBe(
      'the snapshot took longer than 45 seconds',
    )
    expect(startFailureReason('spawn /x/y.sh EACCES', 45)).toBe('the snapshot command is not runnable (permission denied)')
    expect(startFailureReason('spawn /x/y.sh ENOENT', 45)).toBe('the snapshot command was not found')
    expect(startFailureReason('something odd', 45)).toBe('the snapshot command could not be run')
  })

  test('keep a failure reason to one short line', () => {
    expect(failureReasonOf('jq not found\nsecond line')).toBe('jq not found')
    expect(failureReasonOf('')).toBe('no reason given')
    expect(failureReasonOf('x'.repeat(200))).toHaveLength(80)
  })
})
