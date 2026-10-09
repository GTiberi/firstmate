// Fixture snapshots, in the shape `bin/fm-bearings-snapshot.sh --json --fields work` prints
// (schema fm-bearings.v1). Every project, task, and address is invented.

type Json = Record<string, unknown>

export const PR_FEES = 'https://github.com/invented-org/harbor-ledger/pull/42'
export const PR_NOTES = 'https://github.com/invented-org/tideline-docs/pull/9'
export const PR_TAX = 'https://github.com/invented-org/harbor-ledger/pull/41'
export const PR_CRASH = 'https://github.com/invented-org/lantern-app/pull/17'

/** The task ids in BUSY: none of them may ever reach the captain's eyes. */
export const BUSY_IDS = [
  'ledger-export',
  'ledger-fees',
  'dock-audit',
  'lantern-login',
  'lantern-sync',
  'lantern-theme',
  'tide-index',
  'tide-links',
  'crest-api',
  'orphan-work',
  'pick-palette',
  'release-notes',
  'ledger-tax',
  'lantern-crash',
  'docs-links',
  'docs-search',
  'docs-theme',
  'old-hold',
  'lantern-icons',
  'tag-release',
]

const work = (
  id: string,
  state: string,
  repo: string | null,
  doing: string,
  title: string | null,
  since: string | null = '2026-10-08',
  kind = 'ship',
): Json => ({ id, kind, state, repo, doing, title, since })

const gate = (
  id: string,
  title: string,
  blockedBy: string,
  reason: string,
  repo: string | null,
  since: string | null = '2026-10-05',
): Json => ({ id, title, blocked_by: blockedBy, reason, owner: '(main)', repo, since })

const base = (): Json => ({
  schema: 'fm-bearings.v1',
  home: 'invented/firstmate',
  generated: '2026-10-09T12:00:00Z',
  prs: 'not_requested (run: /bearings include PRs)',
  in_flight: [],
  secondmates: [],
  secondmate_reconcile: [],
  decisions_open: [],
  landed: [],
  gates: [],
  reports: [],
  recorded_prs: [],
  omitted: [{ surface: 'live PR discovery + checks', reveal: '--include-prs' }],
})

export const json = (data: Json): string => JSON.stringify(data)

/** Several projects, every state word, decisions with and without an address, landed rows, queued work. */
export const BUSY_DATA: Json = {
  ...base(),
  in_flight: [
    work('ledger-export', 'working', 'harbor-ledger', 'harness busy (claude-hook)', 'Add CSV export to the ledger report'),
    work('ledger-fees', 'done', 'harbor-ledger', `PR ${PR_FEES} checks green`, 'Fix rounding in the fee table'),
    work('dock-audit', 'done', 'harbor-ledger', 'report ready', 'Audit the ledger import paths', '2026-10-06', 'scout'),
    work('lantern-login', 'blocked', 'lantern-app', 'waiting for a test account', 'Passwordless sign in for the lantern app'),
    work('lantern-sync', 'paused', 'lantern-app', 'waiting for the store review to finish', 'Offline sync for lantern notes'),
    work('lantern-theme', 'parked', 'lantern-app', 'parked at review: 2 finding(s) (ask-user: authority decision)', 'Dark theme tokens'),
    work('tide-index', 'failed', 'tideline-docs', 'run failed', 'Rebuild the docs index'),
    work('tide-links', 'unknown', 'tideline-docs', 'backend target gone: firstmate:fm-tide-links', 'Fix broken links'),
    work('crest/crest-api', 'working', null, 'writing the invite flow', null, null),
    work('orphan-work', 'working', null, 'harness busy (claude-hook)', 'A piece without a project', null),
  ],
  decisions_open: [
    {
      id: 'pick-palette',
      key: 'pick-palette',
      verb: 'captain-hold',
      summary: 'Choose the lantern brand palette: Two palettes are ready and the captain picks one',
      owner: '(main)',
    },
    {
      id: 'release-notes',
      key: 'release-notes',
      verb: 'captain-hold',
      summary: 'Approve the release notes wording: the draft is on the pull request',
      owner: '(main)',
    },
  ],
  landed: [
    { id: 'ledger-tax', what: 'Tax summary page', artifact: PR_TAX, owner: '(main)', date: '2026-10-09' },
    { id: 'lantern-crash', what: 'Fix the start-up crash', artifact: PR_CRASH, owner: '(main)', date: '2026-10-08' },
    { id: 'docs-links', what: 'Link audit', artifact: 'data/docs-links/report.md', owner: '(main)', date: '2026-10-02' },
  ],
  gates: [
    gate('docs-search', 'Add search to the docs site', 'ledger-export', 'waits for the export format', 'tideline-docs'),
    gate('docs-theme', 'Dark theme for the docs site', '-', 'until 2026-10-15: Revisit after the rele…', 'tideline-docs', null),
    gate('old-hold', 'Pick a hosting plan', '-', 'held 21d: waiting on a quote', 'harbor-ledger'),
    gate('lantern-icons', 'New icon set', '-', '-', 'lantern-app', null),
    gate('tag-release', 'Tag the release', 'ledger-export,lantern-sync', 'blocked-by ledger-export,lantern-sync: both land first', 'harbor-ledger'),
    gate('(main-inventory)', 'main inventory invalid', '-', 'main inventory', null, null),
  ],
  secondmates: [
    {
      id: 'crest',
      state: 'unknown',
      doing: 'Current home state unavailable',
      provenance: 'structured-home',
      freshness: 'unavailable',
      age_seconds: null,
      contradiction: false,
      reason: '-',
    },
  ],
  recorded_prs: [
    { id: 'ledger-fees', url: PR_FEES },
    { id: 'release-notes', url: PR_NOTES },
  ],
  omitted: [
    { surface: 'gates showing 20 of 24', reveal: '--all-queued' },
    { surface: 'live PR discovery + checks', reveal: '--include-prs' },
  ],
}

export const BUSY = json(BUSY_DATA)

/** A fleet with nothing in it. */
export const EMPTY_FLEET = json(base())

/** One working piece, nothing else: the smallest fleet that has a band count. */
export const ONE_WORKING = json({
  ...base(),
  in_flight: [work('solo-task', 'working', 'harbor-ledger', 'writing the report', 'Write the monthly report')],
})

/** What a code root that predates `--fields work` prints: no title or date on any row. */
export const WITHOUT_WORK_FIELDS = json({
  ...base(),
  in_flight: [
    { id: 'ledger-export', kind: 'ship', state: 'working', repo: 'harbor-ledger', doing: 'writing the CSV export' },
  ],
  gates: [{ id: 'lantern-icons', title: 'New icon set', blocked_by: '-', reason: '-', owner: '(main)' }],
  landed: [{ id: 'ledger-tax', what: 'Tax summary page', artifact: PR_TAX, owner: '(main)' }],
})

/** The same fleet after the piece changed state, for the watched-change ages. */
export const AFTER_CHANGE = json({
  ...base(),
  in_flight: [
    work('solo-task', 'blocked', 'harbor-ledger', 'waiting for a login', 'Write the monthly report', null),
  ],
})
