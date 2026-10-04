import { describe, expect, test } from 'claude-code/testing'

import {
  ansiRowOf,
  CALM_WORKING_SHIP_TICK_MS,
  CALM_WORKING_SHIP_TICKS_PER_MOVE,
  createCalmWorkingShipAnimation,
} from '../lib/working-ship'
import type { CalmWorkingShipAnimation } from '../lib/working-ship'

const HULL = '\\__/'

const rowsOf = (animation: CalmWorkingShipAnimation, width: number): string[] =>
  animation.render(width).map((row) => row.map((run) => run.text).join(''))

function ticks(animation: CalmWorkingShipAnimation, count: number): void {
  for (let tick = 0; tick < count; tick += 1) animation.tick()
}

describe('cadence', () => {
  test('the boat moves one column every 880 ms and the water ripples faster', () => {
    expect(CALM_WORKING_SHIP_TICK_MS * CALM_WORKING_SHIP_TICKS_PER_MOVE).toBe(880)
    expect(CALM_WORKING_SHIP_TICKS_PER_MOVE).toBeGreaterThanOrEqual(2)
    expect(CALM_WORKING_SHIP_TICK_MS).toBeLessThan(880)
  })

  test('the water phase advances every tick while the boat waits for its own', () => {
    const animation = createCalmWorkingShipAnimation()
    animation.render(40)
    const frames = new Set<string>()
    for (let tick = 0; tick < CALM_WORKING_SHIP_TICKS_PER_MOVE - 1; tick += 1) {
      animation.tick()
      expect(animation.position()).toBe(0)
      frames.add(rowsOf(animation, 40)[1] ?? '')
    }
    expect(frames.size).toBe(CALM_WORKING_SHIP_TICKS_PER_MOVE - 1)

    animation.tick()
    expect(animation.position()).toBe(1)
  })

  test('the water phases are bounded fixed-cell runs that never change the geometry', () => {
    const animation = createCalmWorkingShipAnimation()
    const phases = new Set<number>()
    for (let step = 0; step < 64; step += 1) {
      const rows = rowsOf(animation, 30)
      expect(rows).toHaveLength(2)
      expect(rows[1]).toHaveLength(30)
      phases.add(animation.waterPhase())
      animation.tick()
    }
    expect(phases.size).toBeGreaterThan(1)
    expect(phases.size).toBeLessThanOrEqual(8)
  })
})

describe('direction and edges', () => {
  test('the mainsail is <| travelling right and |> travelling left', () => {
    const animation = createCalmWorkingShipAnimation()
    const width = 8
    const sails: string[] = []
    for (let step = 0; step < 9; step += 1) {
      sails.push(`${animation.direction()}:${rowsOf(animation, width)[0]?.trim()}`)
      ticks(animation, CALM_WORKING_SHIP_TICKS_PER_MOVE)
    }
    expect(sails).toEqual(['1:<|', '1:<|', '1:<|', '1:<|', '-1:|>', '-1:|>', '-1:|>', '-1:|>', '1:<|'])
  })

  test('the sail flips on the exact frame the boat reaches an edge', () => {
    const animation = createCalmWorkingShipAnimation()
    const width = 10
    animation.render(width)
    const span = width - HULL.length
    ticks(animation, CALM_WORKING_SHIP_TICKS_PER_MOVE * (span - 1))
    expect(rowsOf(animation, width)[0]?.trim()).toBe('<|')

    ticks(animation, CALM_WORKING_SHIP_TICKS_PER_MOVE)
    expect(animation.position()).toBe(span)
    expect(rowsOf(animation, width)[0]?.trim()).toBe('|>')

    ticks(animation, CALM_WORKING_SHIP_TICKS_PER_MOVE * span)
    expect(animation.position()).toBe(0)
    expect(rowsOf(animation, width)[0]?.trim()).toBe('<|')
  })
})

describe('colour', () => {
  test('water is standard ANSI blue and the whole boat standard ANSI yellow', () => {
    const animation = createCalmWorkingShipAnimation()
    const rows = animation.render(20)

    expect(rows[0]).toEqual([{ text: ' ' }, { text: '<|', color: 'yellow' }])
    expect(rows[1]?.map((run) => run.color)).toEqual(['yellow', 'blue'])
    expect(rows[1]?.[0]?.text).toBe(HULL)
    expect(ansiRowOf(rows[0] ?? [])).toBe(' \u001b[33m<|\u001b[39m')
    expect(ansiRowOf(rows[1] ?? []).startsWith('\u001b[33m\\__/\u001b[39m\u001b[34m')).toBe(true)
    expect(ansiRowOf(rows[1] ?? []).endsWith('\u001b[39m')).toBe(true)
  })
})

describe('width', () => {
  test('a resize clamps the track to the new width without changing the direction', () => {
    const animation = createCalmWorkingShipAnimation()
    animation.render(40)
    ticks(animation, CALM_WORKING_SHIP_TICKS_PER_MOVE * 12)
    expect(animation.position()).toBe(12)

    const rows = rowsOf(animation, 10)

    expect(rows[1]).toHaveLength(10)
    expect(animation.position()).toBe(6)
    expect(animation.direction()).toBe(-1)
    expect(rows[0]?.trim()).toBe('|>')
  })

  test('a width that never changes the heading leaves it travelling', () => {
    const animation = createCalmWorkingShipAnimation()
    animation.render(40)
    ticks(animation, CALM_WORKING_SHIP_TICKS_PER_MOVE * 3)

    animation.clampToWidth(30)

    expect(animation.position()).toBe(3)
    expect(animation.direction()).toBe(1)
  })

  test('narrow terminals fall back to a smaller deterministic sprite', () => {
    const animation = createCalmWorkingShipAnimation()

    expect(rowsOf(animation, 3)).toEqual(['<|-'])
    expect(rowsOf(animation, 2)).toEqual(['<|'])
    expect(rowsOf(animation, 1)).toEqual(['~'])
    expect(animation.render(0)).toEqual([])
    expect(rowsOf(animation, 3)).toEqual(['<|-'])
  })

  test('no frame is wider than its width', () => {
    const animation = createCalmWorkingShipAnimation()
    for (const width of [1, 2, 3, 4, 5, 9, 21, 80]) {
      for (let step = 0; step < 30; step += 1) {
        for (const row of rowsOf(animation, width)) {
          expect(row.length).toBeLessThanOrEqual(width)
        }
        animation.tick()
      }
    }
  })
})

describe('freeze and resume', () => {
  test('restoring the last rendered state resumes where the last frame stopped', () => {
    const animation = createCalmWorkingShipAnimation()
    animation.render(40)
    ticks(animation, CALM_WORKING_SHIP_TICKS_PER_MOVE * 2)
    const drawn = rowsOf(animation, 40)

    // One more tick happened that was never drawn: stopping discards it.
    animation.tick()
    animation.restoreLastRendered()

    expect(rowsOf(animation, 40)).toEqual(drawn)
    expect(animation.position()).toBe(2)
  })

  test('reset starts again at the normal initial position', () => {
    const animation = createCalmWorkingShipAnimation()
    animation.render(40)
    ticks(animation, CALM_WORKING_SHIP_TICKS_PER_MOVE * 5)
    animation.render(40)

    animation.reset()

    expect(animation.position()).toBe(0)
    expect(animation.direction()).toBe(1)
    expect(animation.waterPhase()).toBe(0)
    animation.restoreLastRendered()
    expect(animation.position()).toBe(0)
  })

  test('two animations never share state', () => {
    const left = createCalmWorkingShipAnimation()
    const right = createCalmWorkingShipAnimation()
    left.render(40)
    right.render(40)

    ticks(left, CALM_WORKING_SHIP_TICKS_PER_MOVE * 4)

    expect(left.position()).toBe(4)
    expect(right.position()).toBe(0)
  })
})
