import { describe, expect, test } from 'claude-code/testing'

import { BUSY } from './snapshots'
import { bandLine, CHECKOUT, runFleet, started } from './fixtures'

const OTHER = '/work/another-folder'
const HOME = '/srv/fleet-home'

describe('the home', () => {
  test('is the Firstmate checkout the session runs in when no environment names one', async ($, on) => {
    const world = await started($, on, { stdout: BUSY })

    expect(world.runs).toHaveLength(1)
    expect(world.runs[0]?.argv[0]).toBe(`${CHECKOUT}/bin/fm-bearings-snapshot.sh`)
    expect(world.runs[0]?.cwd).toBe(CHECKOUT)
  })

  test('is FM_HOME when it is set, with the command still taken from the checkout', async ($, on) => {
    const world = await started($, on, {
      stdout: BUSY,
      env: { FM_HOME: HOME },
      files: [`${CHECKOUT}/bin/fm-bearings-snapshot.sh`, `${HOME}/state`],
    })

    expect(world.runs).toHaveLength(1)
    expect(world.runs[0]?.argv[0]).toBe(`${CHECKOUT}/bin/fm-bearings-snapshot.sh`)
    expect(await runFleet($, 'status')).toContain('3 working')
  })

  test('is not a home when FM_HOME holds no runtime records, whatever the checkout holds', async ($, on) => {
    const world = await started($, on, {
      stdout: BUSY,
      env: { FM_HOME: HOME },
      files: [`${CHECKOUT}/bin/fm-bearings-snapshot.sh`, `${CHECKOUT}/state`],
    })

    expect(world.runs).toEqual([])
    expect(await runFleet($, 'status')).toBe('Fleet: this folder is not a Firstmate home.')
  })

  test('finds the command through FM_ROOT_OVERRIDE when the session runs elsewhere', async ($, on) => {
    const world = await started($, on, {
      stdout: BUSY,
      root: OTHER,
      env: { FM_HOME: HOME, FM_ROOT_OVERRIDE: '/opt/firstmate-code' },
      files: ['/opt/firstmate-code/bin/fm-bearings-snapshot.sh', `${HOME}/state`],
    })

    expect(world.runs).toHaveLength(1)
    expect(world.runs[0]?.argv[0]).toBe('/opt/firstmate-code/bin/fm-bearings-snapshot.sh')
    expect(world.runs[0]?.cwd).toBe('/opt/firstmate-code')
  })

  test('is the root override when FM_HOME is unset, as docs/configuration.md says', async ($, on) => {
    const world = await started($, on, {
      stdout: BUSY,
      root: OTHER,
      env: { FM_ROOT_OVERRIDE: '/opt/firstmate-code' },
      files: ['/opt/firstmate-code/bin/fm-bearings-snapshot.sh', '/opt/firstmate-code/state'],
    })

    expect(world.runs).toHaveLength(1)
    expect(await runFleet($, 'status')).toContain('3 working')
  })

  test('is not a home in a folder with no Firstmate checkout, and runs nothing there', async ($, on) => {
    const world = await started($, on, { stdout: BUSY, root: OTHER, files: [] })

    expect(await runFleet($, 'refresh')).toBe('Fleet: this folder is not a Firstmate home.')
    expect(world.runs).toEqual([])
    expect(await bandLine($)).toBe('Fleet: this folder is not a Firstmate home.')
  })

  test('is not a home in a bare checkout that has never run: the command is there, the records are not', async ($, on) => {
    const world = await started($, on, { stdout: BUSY, files: [`${CHECKOUT}/bin/fm-bearings-snapshot.sh`] })

    expect(world.runs).toEqual([])
    expect(await runFleet($, 'status')).toBe('Fleet: this folder is not a Firstmate home.')
  })

  test('ignores an empty FM_HOME', async ($, on) => {
    const world = await started($, on, { stdout: BUSY, env: { FM_HOME: '' } })

    expect(world.runs).toHaveLength(1)
  })
})
