// document-and-review.js
// -----------------------------------------------------------------------------
// A reusable "document a slice of the codebase, then review + fix it" workflow.
//
// The shape it encodes (generic, not tied to any one run):
//   Map     one cartographer reads the code and emits a shared fact sheet
//   Docs ∥  parallel doc writers (disjoint file ownership) run CONCURRENTLY with
//   Review→ a review → adversarial per-finding verify → fix pipeline (code-only)
//   Gates   one agent runs build / lint / test / docs:build (+ optional live trio)
//   Critic  one agent checks the docs match the POST-FIX code; fixers patch drift
//
// Usage
//   Run with no args to document + review the whole branch against `main`.
//   Pass a config object as `args` (object, JSON string, or comma-string of
//   doc labels) to scope a single "document a phase + review it" pass, e.g.:
//
//     args = {
//       base: 'main',                       // git base for the diff/review
//       projectRoot: '/abs/path/to/repo',   // defaults to process.cwd()
//       focus: 'the DSL engine',            // short human description of the slice
//       readFiles: ['server/api.ts', ...],  // files the cartographer must read
//       docWriters: [                       // each owns a DISJOINT set of files
//         { label: 'dsl-guide', owns: ['docs/guide/dsl-reference.md'],
//           prompt: 'Write the user-facing DSL reference …' },
//       ],
//       knownBugs: [ { file, line, description } ], // pre-confirmed; forced into review
//       gateCommands: ['pnpm build','pnpm lint','pnpm test','pnpm docs:build'],
//       liveTrio: false,                    // set true to also boot a server + smoke
//       criticChecks: ['route table == server/api.ts', …],
//     }
//
// Everything is parameterized: the prompts read from `cfg`, so a future pass that
// documents a different phase reuses this file unchanged. Pure JS — no TS
// annotations, no Date.now / Math.random.
// -----------------------------------------------------------------------------

export const meta = {
  name: 'document-and-review',
  description:
    'Map the code to a shared fact sheet, write docs in parallel while reviewing+fixing the branch, gate the result, then critic the docs against the post-fix code.',
  phases: [
    { title: 'Map', detail: 'one cartographer derives the shared fact sheet from the code' },
    { title: 'Docs', detail: 'parallel doc writers with disjoint file ownership' },
    { title: 'Review', detail: 'branch review + adversarial per-finding verify' },
    { title: 'Fix', detail: 'apply only the verified findings (and any known bugs) + tests' },
    { title: 'Gates', detail: 'build / lint / test / docs:build (+ optional live trio)' },
    { title: 'Critic', detail: 'docs-match-code consistency pass, then drift fixers' },
  ],
}

// ---- config -----------------------------------------------------------------

function parseArgs(raw) {
  let a = raw
  if (typeof a === 'string') {
    const s = a.trim()
    if (s.startsWith('{')) {
      try {
        a = JSON.parse(s)
      } catch (e) {
        a = {}
      }
    } else if (s.length) {
      a = { docWriters: s.split(',').map((label) => ({ label: label.trim(), owns: [], prompt: '' })) }
    } else {
      a = {}
    }
  }
  if (!a || typeof a !== 'object') a = {}
  return {
    base: a.base || 'main',
    projectRoot: a.projectRoot || (typeof process !== 'undefined' ? process.cwd() : '.'),
    focus: a.focus || 'the branch',
    readFiles: Array.isArray(a.readFiles) ? a.readFiles : [],
    docWriters: Array.isArray(a.docWriters) ? a.docWriters : [],
    knownBugs: Array.isArray(a.knownBugs) ? a.knownBugs : [],
    gateCommands:
      Array.isArray(a.gateCommands) && a.gateCommands.length
        ? a.gateCommands
        : ['pnpm build', 'pnpm lint', 'pnpm test', 'pnpm docs:build'],
    liveTrio: a.liveTrio === true,
    criticChecks: Array.isArray(a.criticChecks) ? a.criticChecks : [],
    reviewDimensions:
      a.reviewDimensions ||
      'correctness, command/undo atomicity, store-seam discipline, DSL round-trip integrity, data-safety, and lean-code',
  }
}

const cfg = parseArgs(args)
const ROOT = cfg.projectRoot

// ---- schemas ----------------------------------------------------------------

const MAP_SCHEMA = {
  type: 'object',
  required: ['factSheet'],
  properties: {
    factSheet: { type: 'string', description: 'the authoritative, transcribed fact sheet downstream agents trust' },
    surfaces: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'facts'],
        properties: { name: { type: 'string' }, facts: { type: 'string' }, source: { type: 'string' } },
      },
    },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'file', 'severity', 'dimension', 'description'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          dimension: { type: 'string' },
          description: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['isReal', 'reasoning'],
  properties: { isReal: { type: 'boolean' }, reasoning: { type: 'string' }, refinedFix: { type: 'string' } },
}

const FIX_SCHEMA = {
  type: 'object',
  required: ['filesChanged', 'testsAdded', 'summary'],
  properties: {
    filesChanged: { type: 'array', items: { type: 'string' } },
    testsAdded: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

const GATE_SCHEMA = {
  type: 'object',
  required: ['results', 'allGreen', 'details'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['command', 'status'],
        properties: { command: { type: 'string' }, status: { type: 'string' }, note: { type: 'string' } },
      },
    },
    allGreen: { type: 'boolean' },
    details: { type: 'string' },
  },
}

const CRITIC_SCHEMA = {
  type: 'object',
  required: ['clean', 'drift'],
  properties: {
    clean: { type: 'boolean' },
    drift: {
      type: 'array',
      items: {
        type: 'object',
        required: ['doc', 'issue'],
        properties: { doc: { type: 'string' }, issue: { type: 'string' }, fix: { type: 'string' } },
      },
    },
  },
}

// ---- Phase: Map -------------------------------------------------------------

phase('Map')
const readList = cfg.readFiles.length
  ? `Read these files and transcribe (do not paraphrase) the load-bearing facts:\n- ${cfg.readFiles.join('\n- ')}`
  : `Read the code touched on this branch (git diff against ${cfg.base}) plus the modules it depends on.`

const map = await agent(
  `You are the cartographer for a documentation + review pass on the repo at ${ROOT} (focus: ${cfg.focus}). ` +
    `Produce ONE authoritative fact sheet that every downstream doc writer and reviewer will trust. ` +
    `Be exact — names, paths, routes, regexes, record fields, env defaults, and command kinds must be transcribed from source, not recalled.\n\n` +
    `${readList}\n\n` +
    `For each surface you cover, cite the source file (and line where it matters) so a writer can re-verify. ` +
    `Return the fact sheet text plus a per-surface breakdown via the schema.`,
  { schema: MAP_SCHEMA, label: 'cartographer', phase: 'Map' },
)

const factSheet =
  `SHARED FACT SHEET (authoritative — trust this over assumptions; open the cited source file for an exact regex/field):\n\n${map.factSheet}\n\n` +
  `When you need a detail the fact sheet does not capture, read the actual source file. Do NOT invent features.`
log(`Map complete: ${(map.surfaces || []).length} surface(s) catalogued.`)

// ---- Track A: documentation (parallel, disjoint file ownership) -------------

function docsTrack() {
  if (!cfg.docWriters.length) {
    log('No doc writers configured — skipping Docs track.')
    return Promise.resolve([])
  }
  return parallel(
    cfg.docWriters.map((w) => () => {
      const owns = (w.owns || []).length ? `\n\nYou own ONLY these files (no other writer touches them): ${w.owns.join(', ')}.` : ''
      return agent(`${factSheet}\n\n${w.prompt}${owns}\n\nReturn a short manifest of files created/changed.`, {
        label: w.label,
        phase: 'Docs',
      }).catch(() => null)
    }),
  )
}

// ---- Track B: review → verify → fix (code-only) -----------------------------

function reviewFixTrack() {
  const known = cfg.knownBugs.length ? JSON.stringify(cfg.knownBugs, null, 2) : null
  const forced = known
    ? `\n\nThese issues are ALREADY CONFIRMED and MUST appear in your findings as 'major':\n${known}`
    : ''
  return (async () => {
    const review = await agent(
      `${factSheet}\n\nReview the branch at ${ROOT} (git diff against ${cfg.base}) on these dimensions: ${cfg.reviewDimensions}. ` +
        `Read the changed/new code. Report REAL issues only — skip style nits and anything cosmetic. ` +
        `Each finding: id, title, file, line, severity, dimension, description, suggestedFix. Be precise and conservative; do not pad.${forced}`,
      { schema: FINDINGS_SCHEMA, label: 'review', phase: 'Review' },
    )
    const candidates = (review.findings || []).filter((f) => f.severity !== 'nit')
    log(`Review: ${(review.findings || []).length} finding(s), ${candidates.length} non-nit to verify.`)

    const verified = await parallel(
      candidates.map((f) => () =>
        agent(
          `Adversarially verify ONE code-review finding in the repo at ${ROOT}. ` +
            `Default to isReal=false unless you can concretely confirm the failure mode by reading the code.\n` +
            `Finding: ${JSON.stringify(f, null, 2)}\n` +
            `Open ${f.file} and trace it. Confirm whether the bug is real and whether the suggested fix is correct (refine it if needed).`,
          { schema: VERDICT_SCHEMA, label: `verify:${f.id}`, phase: 'Review' },
        )
          .then((v) => ({ ...f, verdict: v }))
          .catch(() => null),
      ),
    )
    const confirmed = verified.filter(Boolean).filter((f) => f.verdict && f.verdict.isReal)
    log(`Verified ${confirmed.length}/${candidates.length} finding(s) as real.`)

    if (!confirmed.length) return { confirmed: [], fix: null }

    phase('Fix')
    const fix = await agent(
      `${factSheet}\n\nApply MINIMAL, lean fixes for these verified findings in the repo at ${ROOT}, and add regression tests. ` +
        `Touch ONLY code + test files (no docs). Do NOT refactor beyond the fix.\n` +
        `Verified findings:\n${JSON.stringify(
          confirmed.map((f) => ({
            file: f.file,
            line: f.line,
            title: f.title,
            fix: (f.verdict && f.verdict.refinedFix) || f.suggestedFix,
          })),
          null,
          2,
        )}\n\n` +
        `After editing, run the test suite and confirm it stays green (count should go UP by the new tests). ` +
        `Return filesChanged, testsAdded, summary.`,
      { schema: FIX_SCHEMA, label: 'fix', phase: 'Fix' },
    )
    return { confirmed, fix }
  })()
}

// Docs (read-only on code) run concurrently with review→verify→fix (code-only).
const [docsResults, reviewFix] = await parallel([docsTrack, reviewFixTrack])
const docsManifests = (docsResults || []).filter(Boolean)
log(
  `Docs writers done: ${docsManifests.length}. ` +
    `Fix: ${reviewFix && reviewFix.fix ? reviewFix.fix.summary : 'no verified findings'}.`,
)

// ---- Phase: Gates -----------------------------------------------------------

phase('Gates')
const liveNote = cfg.liveTrio
  ? `\nAlso run the live trio: boot the built server in the BACKGROUND with temp dirs (mktemp for GNOSIS_DB/FILES/SNAPSHOTS, GNOSIS_STATIC=./dist), ` +
    `wait for readiness with \`curl --retry 20 --retry-delay 1 --retry-connrefused -s http://localhost:8787/api/meta\` (do NOT foreground-sleep), ` +
    `run the project's server/live/smoke checks against it, then kill the server by port. ` +
    `If the live trio cannot run (no browser), report that in details without flipping allGreen on its own.`
  : ''

const gates = await agent(
  `Run the gate suite for the repo at ${ROOT} and report each result precisely. Run these in order and report pass/fail + salient output for each:\n` +
    `${cfg.gateCommands.map((c, i) => `${i + 1}. \`${c}\``).join('\n')}${liveNote}\n\n` +
    `Set allGreen=true only if every required command above passed. Put exact failures and test counts in details.`,
  { schema: GATE_SCHEMA, label: 'gates', phase: 'Gates' },
)
log(`Gates: ${(gates.results || []).map((r) => `${r.command}=${r.status}`).join(' ')} → allGreen=${gates.allGreen}`)

// ---- Phase: Critic (docs match POST-FIX code) -------------------------------

phase('Critic')
const checksNote = cfg.criticChecks.length
  ? `Verify these specific consistencies:\n- ${cfg.criticChecks.join('\n- ')}`
  : `Verify the docs claims (routes, command kinds, env defaults, DSL grammar, record fields) match the current source, and that internal doc links resolve.`

const critic = await agent(
  `${factSheet}\n\nYou are the docs-match-code consistency critic for the repo at ${ROOT}. ` +
    `The docs were just written and the code was just fixed — verify the docs match the POST-FIX code, not the pre-fix code. ` +
    `${checksNote}\nReport every drift as { doc, issue, fix }. Set clean=true only if there is NO drift. Read the actual files; do not assume.`,
  { schema: CRITIC_SCHEMA, label: 'critic', phase: 'Critic' },
)

if (!critic.clean && critic.drift && critic.drift.length) {
  log(`Critic found ${critic.drift.length} drift item(s); dispatching fixers.`)
  await parallel(
    critic.drift.map((d, i) => () =>
      agent(
        `Fix ONE documentation-consistency drift in the repo at ${ROOT}. ` +
          `Edit ONLY the named doc/config file to match the code; do not touch code.\nDrift: ${JSON.stringify(d, null, 2)}`,
        { label: `critic-fix-${i}`, phase: 'Critic' },
      ).catch(() => null),
    ),
  )
}

return {
  focus: cfg.focus,
  surfaces: (map.surfaces || []).length,
  docsWriters: docsManifests.length,
  confirmedFindings: reviewFix ? reviewFix.confirmed.length : 0,
  fix: reviewFix ? reviewFix.fix : null,
  gates,
  criticClean: critic.clean,
  criticDrift: critic.drift || [],
}
