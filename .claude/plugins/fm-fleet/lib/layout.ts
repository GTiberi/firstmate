// Draws a Model as rows of text: the pane's rows, and the band's one line.
//
// A row is a list of runs, each a piece of text in one tone, because the mods API draws colour
// through Text props and takes no escape codes in text. Every row is cut to the width it is given
// before it is returned, so a row never wraps and the pane never grows a row it did not plan.
// A web address is the one run that is never cut mid-word: it keeps both ends, and its `href`
// always holds the whole address.
import type { Failure } from '../types'
import type { Group, Model, QueuedItem, WorkItem } from './model'
import {
  agoWords,
  ageWords,
  cut,
  cutAlways,
  cutMiddle,
  firstWords,
  type Tone,
  widthOf,
} from './words'

export type Run = { text: string; tone?: Tone; bold?: boolean; href?: string }
export type Line = readonly Run[]

/** What the pane and the band are drawn from at one moment. */
export type Frame = {
  /** The model of the last good reading; null before the first one. */
  model: Model | null
  readAt: number
  failure: Failure | null
  now: number
}

/** The narrowest width a row is cut to: below it the cuts leave nothing to read. */
const MIN_COLUMNS = 12
const INDENT = 2
const LINK_INDENT = 4

export function lineText(line: Line): string {
  return line.map((run) => run.text).join('')
}

function lineWidth(runs: readonly Run[]): number {
  return runs.reduce((total, run) => total + widthOf(run.text), 0)
}

/** The runs cut to `width` cells, the last one kept ending in an ellipsis where the cut fell. */
export function fitRuns(runs: readonly Run[], width: number): Run[] {
  if (lineWidth(runs) <= width) return [...runs]
  const out: Run[] = []
  let used = 0
  for (const run of runs) {
    const runWidth = widthOf(run.text)
    if (used + runWidth <= width - 1) {
      out.push(run)
      used += runWidth
      continue
    }
    out.push({ ...run, text: cutAlways(run.text, width - used) })
    break
  }
  return out
}

const dim = (text: string): Run => ({ text, tone: 'dim' })
const plain = (text: string): Run => ({ text })

function counts(model: Model): Run[] {
  return [
    plain(`${model.running} working`),
    dim(' · '),
    { text: `${model.waiting} waiting on you`, tone: model.waiting > 0 ? 'warning' : 'dim' },
    dim(' · '),
    { text: `${model.queued} queued`, tone: model.queued > 0 ? 'plain' : 'dim' },
  ]
}

/**
 * The address on a row of its own. An address that fits is plain text, which a terminal that
 * links addresses links whole; one that does not fit is cut in the middle and keeps its `href`, so
 * the whole address stays behind the cut text. A link element is not used for an address that
 * fits, because a terminal without hyperlinks draws such an element as its text and then the
 * address again.
 */
function linkLine(url: string, width: number, tone: Tone | undefined): Line {
  const room = Math.max(1, width - LINK_INDENT)
  const shown = cutMiddle(url, room)
  const run: Run = shown === url ? { text: url } : { text: shown, href: url }
  if (tone !== undefined) run.tone = tone
  return [plain(' '.repeat(LINK_INDENT)), run]
}

const NOTE_SEPARATOR = ' - '

type Body = { first: Run[]; second: Run[] | null }

/**
 * What a row says after its state word, in `room` cells: the title, the project it belongs to, and
 * what it is doing. All of it goes on the row when it fits. When it does not, the project is left
 * out first; when the title and the note still do not fit together, the note moves to a row of its
 * own under the title rather than being cut away, because the note is the part that says what a
 * piece is waiting for.
 */
function bodyOf(title: string | null, tag: string | null, note: string, room: number): Body {
  const tagText = tag === null ? '' : ` (${tag})`
  const titleText = title ?? ''
  const together = title === null || note === '' ? 0 : NOTE_SEPARATOR.length
  const make = (tagPart: string): Run[] => {
    const runs: Run[] = []
    if (title !== null) runs.push(plain(titleText))
    if (tagPart !== '') runs.push(dim(tagPart))
    if (note !== '') runs.push(dim(title === null ? note : `${NOTE_SEPARATOR}${note}`))
    return runs
  }
  if (widthOf(titleText) + widthOf(tagText) + together + widthOf(note) <= room) return { first: make(tagText), second: null }
  if (widthOf(titleText) + together + widthOf(note) <= room) return { first: make(''), second: null }
  if (title === null) return { first: [dim(cut(note, room))], second: null }
  const first = widthOf(titleText) + widthOf(tagText) <= room ? [plain(titleText), dim(tagText)] : [plain(cut(titleText, room))]
  const second = tag === null ? note : `${tag} - ${note}`
  return { first, second: note === '' ? null : [plain(' '.repeat(LINK_INDENT)), dim(second)] }
}

/** One row of work: its state word, then what it is and does, then its age, then its address. */
function rowLines(
  item: Pick<WorkItem, 'word' | 'tone' | 'title' | 'age' | 'url'> & { text: string; tag?: string | null },
  width: number,
): Line[] {
  const right: Run[] = item.age === null ? [] : [dim(` · ${item.age}`)]
  const lead: Run[] = [plain(' '.repeat(INDENT)), { text: item.word, tone: item.tone }]
  const separator = dim(' · ')
  const room = width - lineWidth(lead) - widthOf(separator.text) - lineWidth(right)
  const body = bodyOf(item.title, item.tag ?? null, item.text, room)
  const row = body.first.length === 0 ? lead : [...lead, separator, ...body.first]
  const lines: Line[] = [[...fitRuns(row, width - lineWidth(right)), ...right]]
  if (body.second !== null) lines.push(fitRuns(body.second, width))
  if (item.url !== null) lines.push(linkLine(item.url, width, undefined))
  return lines
}

function groupLines(group: Group, width: number): Line[] {
  const lines: Line[] = [[{ text: cut(group.name, width), bold: true }]]
  for (const item of group.items) {
    lines.push(...rowLines({ ...item, text: item.doing }, width))
  }
  return lines
}

function queuedLines(item: QueuedItem, width: number): Line[] {
  return rowLines(
    { ...item, title: item.title === '' ? null : item.title, text: item.note, tag: item.repo, age: null, url: null },
    width,
  )
}

function heading(text: string, tone: Tone | undefined, width: number): Line {
  const run: Run = { text: cut(text, width), bold: true }
  if (tone !== undefined) run.tone = tone
  return [run]
}

function note(text: string, width: number, tone: Tone = 'dim'): Line {
  return fitRuns([plain(' '.repeat(INDENT)), { text, tone }], width)
}

export function paneLines(frame: Frame, columns: number): Line[] {
  const width = Math.max(MIN_COLUMNS, columns)
  const { model, failure } = frame

  if (failure !== null && failure.kind === 'not-a-home') {
    return [
      heading('Fleet', undefined, width),
      note('This folder is not a Firstmate home, so there is no fleet to show.', width),
    ]
  }

  const lines: Line[] = []
  if (model === null) {
    lines.push(heading('Fleet', undefined, width))
    if (failure === null) lines.push(note('Reading the fleet…', width))
    else {
      lines.push(note(`Fleet state unavailable: ${failure.reason}`, width, 'warning'))
      lines.push(note('There is no earlier reading to show.', width))
    }
    return lines
  }

  lines.push(
    fitRuns([{ text: 'Fleet', bold: true }, dim(`  updated ${agoWords(frame.now - frame.readAt)}`)], width),
  )
  if (failure !== null) {
    lines.push(note(`Fleet state unavailable: ${failure.reason}`, width, 'warning'))
    lines.push(note(`Showing the reading from ${ageWords(frame.now - frame.readAt)} ago.`, width))
  }
  lines.push(fitRuns(counts(model), width))

  lines.push(heading('Waiting on you', model.waiting > 0 ? 'warning' : undefined, width))
  if (model.waitingItems.length === 0) lines.push(note('Nothing needs your action right now.', width))
  for (const item of model.waitingItems) {
    lines.push(note(item.text, width, 'warning'))
    if (item.url !== null) lines.push(linkLine(item.url, width, 'warning'))
  }

  lines.push(heading('Under way', undefined, width))
  if (model.groups.length === 0) lines.push(note('Nothing is under way.', width))
  for (const group of model.groups) lines.push(...groupLines(group, width))

  lines.push(heading('Recently landed', 'dim', width))
  if (model.landed.length === 0) lines.push(note('No recent completions.', width))
  for (const item of model.landed) {
    lines.push(fitRuns([plain(' '.repeat(INDENT)), dim(item.when === null ? item.what : `${item.what} · ${item.when}`)], width))
    if (item.url !== null) lines.push(linkLine(item.url, width, 'dim'))
    else if (item.artifact !== '') {
      lines.push(fitRuns([plain(' '.repeat(LINK_INDENT)), dim(item.artifact)], width))
    }
  }

  lines.push(heading('Queued', undefined, width))
  if (model.queuedItems.length === 0) lines.push(note('Nothing is queued.', width))
  for (const item of model.queuedItems) lines.push(...queuedLines(item, width))

  for (const text of model.notices) lines.push(note(text, width))
  return lines
}

/**
 * The band's one line, or null when the band has nothing to say: a session that has not asked
 * for the fleet and is not in a Firstmate home stays quiet rather than announcing itself.
 */
export function bandRuns(frame: Frame, columns: number, isAsked: boolean): Run[] | null {
  const width = Math.max(MIN_COLUMNS, columns)
  const { model, failure } = frame

  if (failure !== null && failure.kind === 'not-a-home') {
    return isAsked ? fitRuns([dim('Fleet: this folder is not a Firstmate home.')], width) : null
  }
  if (model === null) {
    if (failure === null) return fitRuns([dim('Fleet: reading…')], width)
    return fitRuns(
      [{ text: `Fleet state unavailable: ${failure.reason}`, tone: 'warning' }, dim(' (no earlier reading)')],
      width,
    )
  }
  if (failure !== null) {
    return fitRuns(
      [
        { text: 'Fleet state unavailable', tone: 'warning' },
        dim(` (${failure.reason}; last reading ${agoWords(frame.now - frame.readAt)})`),
      ],
      width,
    )
  }
  if (model.pieces + model.waiting + model.queued === 0) {
    return fitRuns([dim('Fleet: nothing under way')], width)
  }
  const oldest = model.waitingItems[0]
  const runs: Run[] = [plain('Fleet: '), ...counts(model)]
  if (oldest !== undefined) {
    runs.push(dim(' - '))
    runs.push({ text: firstWords(oldest.text, 40), tone: 'warning' })
  }
  return fitRuns(runs, width)
}
