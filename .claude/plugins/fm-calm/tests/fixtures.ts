// A session of the Calm mod in a world the tests script: an in-memory file system, the
// environment, the clock, and the session's directories. Every path is invented.
import type {
  Args,
  CommandSpec,
  On,
  RenderElement,
  RenderPropsOf,
  SessionStartInput,
} from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

import type { ShipRow, ShipRun } from '../lib/working-ship'
import { ansiRowOf } from '../lib/working-ship'

export const CHECKOUT = '/work/firstmate'
export const MARKER = `${CHECKOUT}/bin/fm-session-start.sh`
export const PREFERENCE = `${CHECKOUT}/config/calm`

export const SESSION: SessionStartInput = {
  surface: 'terminal',
  isInteractive: true,
  cwd: CHECKOUT,
}

/** What the engine draws at a site no plugin answers, standing in beneath the mod. */
export const STOCK: RenderElement = { type: 'Text', children: ['stock'] }

/** What the engine draws for the question dialog, which only it may draw. */
export const ENGINE_DIALOG: RenderElement = { type: 'engine', ref: 0 }

export type WorldOptions = {
  env?: Record<string, string>
  /** Files that exist before the session starts, by absolute path. */
  files?: Record<string, string>
  /** The session's project root; the Firstmate checkout unless given. */
  root?: string
  cwd?: string
  /** Whether the session's directories hold bin/fm-session-start.sh; true unless false. */
  isCheckout?: boolean
  failWrite?: boolean
  failRename?: boolean
  /** The file exists but $.fs.read refuses it. */
  unreadable?: boolean
  /** Another plugin already owns the name /calm. */
  commandTaken?: boolean
}

export type World = {
  files: Map<string, string>
  /** Every path $.fs.write was asked to write, in order. */
  writes: string[]
  /** Every argv $.process.run was asked to run, in order. */
  runs: string[][]
  /** How many times the mod asked the engine to redraw. */
  invalidations: { count: number }
  /** Every command $.command.register was asked to declare. */
  commands: CommandSpec[]
  clock: MockClock
}

const RAN = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

export function inWorld(on: On, options: WorldOptions = {}): World {
  const files = new Map<string, string>(Object.entries(options.files ?? {}))
  if (options.isCheckout !== false) files.set(MARKER, '')
  const writes: string[] = []
  const runs: string[][] = []
  const invalidations = { count: 0 }
  const commands: CommandSpec[] = []
  const root = options.root ?? CHECKOUT

  mock.env(on, options.env ?? {})
  const clock = mock.clock(on)

  on('session.root', () => ({ value: root }))
  on('session.cwd', () => ({ value: options.cwd ?? root }))
  on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
  on('fs.read', (_$, e) => {
    if (options.unreadable === true) return { deny: 'EACCES: permission denied' }
    const text = files.get(e.path)
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.write', (_$, e) => {
    writes.push(e.path)
    if (options.failWrite === true) return { deny: 'EACCES: permission denied' }
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    const [program, flag, first, second] = e.argv
    if (program === 'mv' && flag === '-f' && first !== undefined && second !== undefined) {
      if (options.failRename === true) {
        return { value: { ...RAN, exitCode: 1, stderr: 'mv: cannot move: permission denied\n' } }
      }
      files.set(second, files.get(first) ?? '')
      files.delete(first)
    }
    if (program === 'rm' && flag === '-f' && first !== undefined) files.delete(first)
    return { value: RAN }
  })
  on('command.register', (_$, e) => {
    commands.push(e)
    if (options.commandTaken === true) return { deny: `"/${e.name}" refused: it is the built-in /${e.name}` }
    return { value: { command: e.name } }
  })
  on('session.start', () => ({ cwd: options.cwd ?? root }))
  on('classic.SessionStart', () => ({}))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.invalidate', () => {
    invalidations.count += 1
    return { value: undefined }
  })
  on('ui.render', (_$, e) => (e.component === 'AskUserQuestion' ? ENGINE_DIALOG : STOCK))

  return { files, writes, runs, invalidations, commands, clock }
}

export async function startSession($: Engine): Promise<void> {
  await $.session.start(SESSION)
}

export const START_TURN = { text: 'hello', turnId: 't1' }

export async function startTurn($: Engine, turnId = 't1'): Promise<void> {
  await $.turn.start({ text: 'hello', turnId })
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

export async function runCalm($: Engine, args = ''): Promise<string | undefined> {
  const answer = await $.command.run({
    command: 'calm',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  return answer.text
}

type Props<C extends keyof RenderPropsOf> = RenderPropsOf[C]

export const SPINNER_PROPS: Props<'Spinner'> = {
  word: 'Sauteing',
  message: null,
  suffix: '…',
  mode: 'requesting',
}

export async function drawSpinner($: Engine, columns = 40): Promise<RenderElement> {
  return $.ui.render({
    surface: 'terminal',
    component: 'Spinner',
    requestId: 'main',
    viewport: { columns, rows: 24 },
    props: SPINNER_PROPS,
  })
}

export const TOOL_ROWS: { [C in 'ToolUse' | 'ToolResult' | 'ToolGroup' | 'ToolProgress']: Args<'ui.render'> } = {
  ToolUse: {
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'toolu_1',
    props: {
      tool_use_id: 'toolu_1',
      tool: 'Bash',
      input: { command: 'ls' },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    },
  },
  ToolResult: {
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'toolu_1',
    props: { tool_use_id: 'toolu_1', tool: 'Bash', output: { stdout: 'a\nb\n' }, isErrored: false },
  },
  ToolGroup: {
    surface: 'terminal',
    component: 'ToolGroup',
    requestId: 'group_1',
    props: {
      calls: [
        {
          tool_use_id: 'toolu_2',
          tool: 'Read',
          input: { file_path: '/work/a.txt' },
          isRunning: false,
          isErrored: false,
          isInterrupted: false,
        },
      ],
      isActive: false,
      isExpanded: false,
    },
  },
  ToolProgress: {
    surface: 'terminal',
    component: 'ToolProgress',
    requestId: 'toolu_3',
    props: { tool_use_id: 'toolu_3', kind: 'background_hint', hint: '(ctrl+b to run in background)' },
  },
}

export async function drawUserMessage($: Engine, text: string): Promise<RenderElement> {
  return $.ui.render({
    surface: 'terminal',
    component: 'UserMessage',
    requestId: 'msg_1',
    props: { text, origin: { kind: 'composer' }, isExpanded: false },
  })
}

/** The operational prefix: U+2063 INVISIBLE SEPARATOR then "FIRSTMATE_OP: ". */
export const OPERATIONAL = '⁣FIRSTMATE_OP: v1 watcher: wake: signal fm-task-1'

export function isStock(tree: RenderElement): boolean {
  return tree.type === 'Text' && textOf(tree) === 'stock'
}

export function isNothing(tree: RenderElement): boolean {
  return tree.type === 'Box' && (tree.children ?? []).length === 0
}

type Node = string | { type: string; props?: Record<string, unknown>; children?: readonly Node[] }

export function textOf(node: Node): string {
  if (typeof node === 'string') return node
  return (node.children ?? []).map(textOf).join('')
}

/** The boat's rows as the tree draws them: one list of colored runs per row. */
export function shipRowsOf(tree: RenderElement): ShipRow[] {
  const rows = (tree as { children?: readonly Node[] }).children ?? []
  return rows.map((row) => {
    if (typeof row === 'string') return [{ text: row }]
    return (row.children ?? []).map((cell): ShipRun => {
      if (typeof cell === 'string') return { text: cell }
      const color = cell.props?.color
      return color === 'blue' || color === 'yellow'
        ? { text: textOf(cell), color }
        : { text: textOf(cell) }
    })
  })
}

export function ansiOf(tree: RenderElement): string[] {
  return shipRowsOf(tree).map(ansiRowOf)
}
