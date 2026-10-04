import { describe, expect, test } from 'claude-code/testing'

import {
  CHECKOUT,
  drawSpinner,
  inWorld,
  isStock,
  PREFERENCE,
  runCalm,
  startSession,
  startTurn,
} from './fixtures'
describe('the stored choice', () => {
  test('an absent file reads as off', async ($, on) => {
    inWorld(on)
    await startSession($)

    expect(await runCalm($, 'status')).toBe('Calm is off.')
  })

  test('on reads as on', async ($, on) => {
    inWorld(on, { files: { [PREFERENCE]: 'on\n' } })
    await startSession($)

    expect(await runCalm($, 'status')).toBe('Calm is on.')
  })

  test('off reads as off', async ($, on) => {
    inWorld(on, { files: { [PREFERENCE]: 'off\n' } })
    await startSession($)

    expect(await runCalm($, 'status')).toBe('Calm is off.')
  })

  test('the legacy max reads as on', async ($, on) => {
    inWorld(on, { files: { [PREFERENCE]: 'max\n' } })
    await startSession($)

    expect(await runCalm($, 'status')).toBe('Calm is on.')
  })

  test('an unrecognized value reads as off', async ($, on) => {
    inWorld(on, { files: { [PREFERENCE]: 'banana\n' } })
    await startSession($)

    expect(await runCalm($, 'status')).toBe('Calm is off.')
  })

  test('an unreadable file reads as off', async ($, on) => {
    inWorld(on, { files: { [PREFERENCE]: 'on\n' }, unreadable: true })
    await startSession($)

    expect(await runCalm($, 'status')).toBe('Calm is off.')
  })

  test('a toggle made elsewhere is picked up at the next start, resume, or clear', async ($, on) => {
    const world = inWorld(on)
    await startSession($)
    expect(await runCalm($, 'status')).toBe('Calm is off.')

    world.files.set(PREFERENCE, 'on\n')
    await $.classic.SessionStart({ source: 'clear' })
    expect(await runCalm($, 'status')).toBe('Calm is on.')

    world.files.set(PREFERENCE, 'off\n')
    await $.classic.SessionStart({ source: 'resume' })
    expect(await runCalm($, 'status')).toBe('Calm is off.')
  })
})

describe('/calm', () => {
  test('toggles between on and off and writes on or off with one newline', async ($, on) => {
    const world = inWorld(on)
    await startSession($)

    expect(await runCalm($)).toBe('Calm is on.')
    expect(world.files.get(PREFERENCE)).toBe('on\n')

    expect(await runCalm($)).toBe('Calm is off.')
    expect(world.files.get(PREFERENCE)).toBe('off\n')
  })

  test('accepts an explicit on, off, and status, in any case', async ($, on) => {
    const world = inWorld(on)
    await startSession($)

    expect(await runCalm($, 'ON')).toBe('Calm is on.')
    expect(await runCalm($, 'on')).toBe('Calm is on.')
    expect(world.files.get(PREFERENCE)).toBe('on\n')
    expect(await runCalm($, ' status ')).toBe('Calm is on.')
    expect(await runCalm($, 'off')).toBe('Calm is off.')
    expect(await runCalm($, 'off')).toBe('Calm is off.')
    expect(world.files.get(PREFERENCE)).toBe('off\n')
  })

  test('an unknown word changes nothing and says how to use it', async ($, on) => {
    const world = inWorld(on)
    await startSession($)

    expect(await runCalm($, 'max')).toBe('Usage: /calm [on|off|status]')
    expect(world.writes).toEqual([])
    expect(world.files.has(PREFERENCE)).toBe(false)
  })

  test('replaces the file atomically: a sibling temporary file, then one rename', async ($, on) => {
    const world = inWorld(on)
    await startSession($)

    await runCalm($, 'on')

    expect(world.writes).toHaveLength(1)
    const temporary = world.writes[0] ?? ''
    expect(temporary).not.toBe(PREFERENCE)
    expect(temporary.startsWith(`${PREFERENCE}.`)).toBe(true)
    expect(temporary.endsWith('.tmp')).toBe(true)
    expect(world.runs).toEqual([['mv', '-f', temporary, PREFERENCE]])
    expect([...world.files.keys()].filter((path) => path.endsWith('.tmp'))).toEqual([])
  })

  test('a failed write leaves the choice unchanged and says so', async ($, on) => {
    const world = inWorld(on, { failWrite: true })
    await startSession($)

    const reply = await runCalm($, 'on')

    expect(reply).toBe('Calm is still off: could not save config/calm (EACCES: permission denied).')
    expect(world.files.has(PREFERENCE)).toBe(false)
    expect(await runCalm($, 'status')).toBe('Calm is off.')
    await startTurn($)
    expect(isStock(await drawSpinner($))).toBe(true)
  })

  test('a failed rename leaves the choice and the file unchanged and cleans up', async ($, on) => {
    const world = inWorld(on, { failRename: true, files: { [PREFERENCE]: 'on\n' } })
    await startSession($)

    const reply = await runCalm($, 'off')

    expect(reply).toContain('Calm is still on: could not save config/calm')
    expect(reply).toContain('permission denied')
    expect(world.files.get(PREFERENCE)).toBe('on\n')
    expect([...world.files.keys()].filter((path) => path.endsWith('.tmp'))).toEqual([])
    expect(await runCalm($, 'status')).toBe('Calm is on.')
  })

  test('the persisted choice changes the presentation only once the file is replaced', async ($, on) => {
    const world = inWorld(on)
    await startSession($)
    await startTurn($)
    const before = world.invalidations.count

    await runCalm($, 'on')

    expect(world.invalidations.count).toBeGreaterThan(before)
    expect(isStock(await drawSpinner($))).toBe(false)
  })

  test('is registered to run while a turn is under way', async ($, on) => {
    const world = inWorld(on)
    await startSession($)

    expect(world.commands).toEqual([
      {
        name: 'calm',
        description: "Toggle Firstmate's Calm transcript presentation (on, off, status).",
        argumentHint: '[on|off|status]',
        immediate: true,
      },
    ])
  })

  test('a name another plugin already took costs the mod its command, not the session', async ($, on) => {
    inWorld(on, { files: { [PREFERENCE]: 'on\n' }, commandTaken: true })

    await startSession($)
    await startTurn($)

    expect(isStock(await drawSpinner($))).toBe(false)
  })
})

describe('where the home is', () => {
  test('FM_HOME wins over everything else', async ($, on) => {
    const world = inWorld(on, { env: { FM_HOME: '/homes/alpha', FM_ROOT_OVERRIDE: '/homes/beta' } })
    await startSession($)

    await runCalm($, 'on')

    expect(world.files.get('/homes/alpha/config/calm')).toBe('on\n')
    expect(world.files.has(PREFERENCE)).toBe(false)
  })

  test('FM_ROOT_OVERRIDE is next', async ($, on) => {
    const world = inWorld(on, { env: { FM_ROOT_OVERRIDE: '/homes/beta/' } })
    await startSession($)

    await runCalm($, 'on')

    expect(world.files.get('/homes/beta/config/calm')).toBe('on\n')
  })

  test('FM_CONFIG_OVERRIDE names the config directory itself', async ($, on) => {
    const world = inWorld(on, { env: { FM_HOME: '/homes/alpha', FM_CONFIG_OVERRIDE: '/cfg' } })
    await startSession($)

    await runCalm($, 'on')

    expect(world.files.get('/cfg/calm')).toBe('on\n')
    expect(world.files.has('/homes/alpha/config/calm')).toBe(false)
  })

  test('an empty variable counts as unset', async ($, on) => {
    const world = inWorld(on, { env: { FM_HOME: '' } })
    await startSession($)

    await runCalm($, 'on')

    expect(world.files.get(PREFERENCE)).toBe('on\n')
  })

  test('without FM_HOME the checkout the session runs in is the home', async ($, on) => {
    const world = inWorld(on)
    await startSession($)

    await runCalm($, 'on')

    expect(world.files.get(`${CHECKOUT}/config/calm`)).toBe('on\n')
  })

  test('a session whose root is elsewhere falls back to its working directory', async ($, on) => {
    const world = inWorld(on, { root: '/work/elsewhere', cwd: CHECKOUT })
    await startSession($)

    await runCalm($, 'on')

    expect(world.files.get(PREFERENCE)).toBe('on\n')
  })

  test('a session outside any Firstmate home never writes anywhere', async ($, on) => {
    const world = inWorld(on, { isCheckout: false, root: '/work/other-project' })
    await startSession($)

    const reply = await runCalm($, 'on')

    expect(reply).toBe(
      'Calm is still off: could not save config/calm (no Firstmate home: run Claude Code in a Firstmate checkout or set FM_HOME).',
    )
    expect(world.writes).toEqual([])
    expect(world.runs).toEqual([])
    expect(await runCalm($, 'status')).toBe('Calm is off.')
  })
})
