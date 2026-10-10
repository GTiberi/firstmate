// A session of the fleet mod in a world the tests script: the file system, the environment, the
// clock, the snapshot command, and the panes. Every path and name is invented.
import type { Args, On, RenderElement, SessionStartInput } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

import { SNAPSHOT_ARGS } from '../lib/snapshot'

export const CHECKOUT = '/work/firstmate'
export const SCRIPT = `${CHECKOUT}/bin/fm-bearings-snapshot.sh`
export const STATE_DIR = `${CHECKOUT}/state`

export const SESSION: SessionStartInput = {
  surface: 'terminal',
  isInteractive: true,
  cwd: CHECKOUT,
}

/** What the engine draws at a site no plugin answers, standing in beneath the mod. */
export const STOCK: RenderElement = { type: 'Text', children: ['stock'] }

export type Ran = { argv: string[]; cwd: string | undefined; timeoutMs: number | undefined }

export type WorldOptions = {
  env?: Record<string, string>
  root?: string
  /** Paths that exist; the checkout's snapshot command and state directory unless given. */
  files?: string[]
  /** What the snapshot command prints, or a function of the run number (1 for the first). */
  stdout?: string | ((run: number) => string)
  exitCode?: number
  stderr?: string
  /** The command cannot run: process.run rejects with this message. */
  rejects?: string
  /** Hold every run until `release()` is called, to prove two never overlap. */
  hold?: boolean
  /** Whether a pane the mod opens is drawn (placed), as on a wide terminal; true unless false. */
  isPlaced?: boolean
  commandTaken?: boolean
}

export type World = {
  /** Every run of process.run, in order. */
  runs: Ran[]
  /** How many runs have started and not yet finished. */
  active: { count: number; max: number }
  release: () => void
  opens: { id: string; title?: string; columns?: number }[]
  closes: string[]
  commands: { name: string; immediate?: true; argumentHint?: string }[]
  clock: MockClock
  /** Changes what the next runs print. */
  setStdout: (stdout: string | ((run: number) => string)) => void
  setExit: (exitCode: number, stderr?: string) => void
  setRejects: (message: string | undefined) => void
}

export function inWorld(on: On, options: WorldOptions = {}): World {
  const files = new Set(options.files ?? [SCRIPT, STATE_DIR])
  const root = options.root ?? CHECKOUT
  const runs: Ran[] = []
  const active = { count: 0, max: 0 }
  const opens: World['opens'] = []
  const closes: string[] = []
  const commands: World['commands'] = []
  const open = new Set<string>()
  let stdout = options.stdout ?? '{}'
  let exitCode = options.exitCode ?? 0
  let stderr = options.stderr ?? ''
  let rejects = options.rejects
  let held: (() => void)[] = []
  let isHeld = options.hold === true

  mock.env(on, options.env ?? {})
  const clock = mock.clock(on, { now: Date.parse('2026-10-09T12:00:00Z') })

  on('session.root', () => ({ value: root }))
  on('session.cwd', () => ({ value: root }))
  on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
  on('process.run', async (_$, e) => {
    runs.push({ argv: [...e.argv], cwd: e.init?.cwd, timeoutMs: e.init?.timeoutMs })
    active.count += 1
    active.max = Math.max(active.max, active.count)
    try {
      if (isHeld) await new Promise<void>((resolve) => held.push(resolve))
      if (rejects !== undefined) return { deny: rejects }
      const text = typeof stdout === 'function' ? stdout(runs.length) : stdout
      return {
        value: { exitCode, stdout: text, stderr, isStdoutTruncated: false, isStderrTruncated: false },
      }
    } finally {
      active.count -= 1
    }
  })
  on('command.register', (_$, e) => {
    commands.push(e)
    if (options.commandTaken === true) return { deny: `"/${e.name}" refused: it is the built-in /${e.name}` }
    return { value: { command: e.name } }
  })
  on('ui.open', (_$, e) => {
    opens.push(e)
    if (options.isPlaced === false) return { value: { isPlaced: false, reason: 'the terminal is too narrow' } }
    open.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    closes.push(e.id)
    open.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...open].map((id) => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })),
  }))
  on('session.start', () => ({ cwd: root }))
  on('classic.SessionStart', () => ({}))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => STOCK)

  return {
    runs,
    active,
    release: () => {
      isHeld = false
      for (const resolve of held) resolve()
      held = []
    },
    opens,
    closes,
    commands,
    clock,
    setStdout: (next) => {
      stdout = next
    },
    setExit: (code, text = '') => {
      exitCode = code
      stderr = text
    },
    setRejects: (message) => {
      rejects = message
    },
  }
}

export async function startSession($: Engine): Promise<void> {
  await $.session.start(SESSION)
}

export async function endTurn($: Engine, turnId = 't1', agentId?: string): Promise<void> {
  await $.turn.complete({
    answer: 'done',
    durationMs: 1,
    isAborted: false,
    turnId,
    reason: 'answer',
    ...(agentId === undefined ? {} : { agentId }),
  })
}

export async function runFleet(
  $: Engine,
  args = '',
  presentation = { isFullscreen: false, columns: 80 },
): Promise<string | undefined> {
  const answer = await $.command.run({
    command: 'fleet',
    args,
    origin: { kind: 'composer' },
    presentation,
  })
  return answer.text
}

/** The argv a snapshot run is expected to have. */
export const EXPECTED_ARGV = [SCRIPT, ...SNAPSHOT_ARGS]

type Node = string | { type: string; props?: Record<string, unknown>; children?: readonly Node[] }

/** The text a tree shows: strings, and the label a Link shows. */
export function textOf(node: Node): string {
  if (typeof node === 'string') return node
  if (node.type === 'Link') return String(node.props?.label ?? node.props?.href ?? '')
  return (node.children ?? []).map(textOf).join('')
}

/** The rows of a pane or band tree: the text of each child of its root Box. */
export function rowsOf(tree: RenderElement): string[] {
  const root = tree as { children?: readonly Node[] }
  return (root.children ?? []).map(textOf)
}

/** The hrefs of every Link in a tree, in order. */
export function hrefsOf(node: Node): string[] {
  if (typeof node === 'string') return []
  const own = node.type === 'Link' && typeof node.props?.href === 'string' ? [node.props.href] : []
  return [...own, ...(node.children ?? []).flatMap(hrefsOf)]
}

export const PANE_ID = 'fm-fleet'

export function paneProps(columns: number, placement: 'dock' | 'inline' = 'dock'): Args<'ui.render'>['props'] {
  return { title: 'Fleet', isFocused: false, bodyColumns: columns, placement, scroll: { offset: 0, bodyRows: 60 }, view: {} } as never
}

export async function drawPane($: Engine, columns = 52): Promise<RenderElement> {
  return $.ui.render({
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE_ID,
    viewport: { columns: columns + 60, rows: 40, isFullscreen: true },
    props: paneProps(columns),
  } as never)
}

export type BandOptions = { columns?: number; isFullscreen?: boolean; hasSurvey?: boolean; surface?: 'terminal' | 'desktop' }

export async function drawBand($: Engine, options: BandOptions = {}): Promise<RenderElement> {
  const columns = options.columns ?? 100
  return $.ui.render({
    surface: options.surface ?? 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    viewport: { columns, rows: 30, isFullscreen: options.isFullscreen ?? false },
    props: {
      hasSurvey: options.hasSurvey ?? false,
      isWorking: false,
      maxRows: 4,
      bodyColumns: columns - 5,
      scroll: { offset: 0, bodyRows: 4 },
      view: {},
    },
  } as never)
}

/** The band's own line: the first row of its column, above whatever the other mods drew. */
export async function bandLine($: Engine, options: BandOptions = {}): Promise<string | undefined> {
  const tree = await drawBand($, options)
  return isStock(tree) ? undefined : rowsOf(tree)[0]
}

export function isStock(tree: RenderElement): boolean {
  return tree.type === 'Text' && textOf(tree as Node) === 'stock'
}

/** A world whose session has started and whose first read has finished. */
export async function started($: Engine, on: On, options: WorldOptions = {}): Promise<World> {
  const world = inWorld(on, options)
  await startSession($)
  await world.clock.settle()
  return world
}
