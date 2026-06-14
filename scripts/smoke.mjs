// Browser smoke harness for the verification gate (project-spec.md §11).
// Run against the self-hosted server (`pnpm server`) — it serves the production
// SPA and the data API on the same origin. Reads probe GET <base>/api/export.
// Usage: node scripts/smoke.mjs [url]
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const URL = process.argv[2] ?? 'http://localhost:8787'
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`

const failures = []
let passed = 0

function check(name, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failures.push(name)
    console.log(`  FAIL ${name} ${detail}`)
  }
}

// The server is the single source of truth: read the WorkspaceBundle straight
// off the HTTP API rather than reaching into browser storage.
async function bundle() {
  const r = await fetch(`${URL}/api/export`)
  if (!r.ok) throw new Error(`GET /api/export -> ${r.status}`)
  return r.json()
}

const counts = async () => {
  const b = await bundle()
  return {
    nodes: b.nodes.length,
    graphs: b.graphs.length,
    placements: b.placements.length,
    edges: b.edges.length,
  }
}

const nodeByTitle = async (title) => (await bundle()).nodes.find((n) => n.title === title) ?? null

// Phase 1 payload is a file/link reference — content lives in bundle.files.
const fileContentByTitle = async (title) => {
  const b = await bundle()
  const node = b.nodes.find((n) => n.title === title)
  if (node?.payload?.kind !== 'file') return null
  return b.files.find((f) => f.id === node.payload.fileId)?.content ?? null
}

// The seeded Home pointer node — the one referring to the root graph. Targeted by
// id rather than DOM order so the drill-in test never grabs a stray sibling node.
const pointerNode = async () => {
  const b = await bundle()
  return b.nodes.find((n) => n.childGraphId === b.meta.rootGraphId) ?? null
}

const crumbs = (page) =>
  page.$$eval('.breadcrumbs-link, .breadcrumbs-current', (els) => els.map((e) => e.textContent))

async function createViaPicker(page, title, at) {
  await page.dblclick('.react-flow__pane', { position: at })
  await page.waitForSelector('.picker-input')
  await page.fill('.picker-input', title)
  await page.waitForTimeout(120)
  await page.press('.picker-input', 'Enter')
  await page.waitForSelector('.picker-input', { state: 'detached' })
  await page.waitForTimeout(700) // post-create setCenter settles
}

async function drillIntoSelection(page) {
  await page.keyboard.press('Enter')
  await page.waitForSelector('.confirm-dialog')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(450)
}

async function openSettings(page, category) {
  await page.click('.sidebar-nav-item:has-text("Settings")')
  await page.waitForSelector('.settings-modal')
  if (category) await page.click(`.settings-nav-item:has-text("${category}")`)
}

async function closeSettings(page) {
  await page.click('.settings-content-header [aria-label="Close"]')
  await page.waitForSelector('.settings-modal', { state: 'detached' })
}

const browser = await chromium.launch({ executablePath: CHROME })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const errors = []
const page = await context.newPage()
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (err) => errors.push(String(err)))

console.log(`smoke: ${URL}`)

// A — boot: the app drops straight into the canvas root (no Landing in this build)
await page.goto(URL)
await page.waitForSelector('.react-flow__node')
check('boot lands on the project root', (await crumbs(page)).join('') === 'Default')
let c = await counts()
check('seed: Home + root graph + pointer node', c.graphs === 2 && c.nodes === 1 && c.placements === 1)
await page.reload()
await page.waitForSelector('.react-flow__node')
c = await counts()
check('reload does not re-seed', c.graphs === 2 && c.nodes === 1)

// B — drill into the root graph via its pointer node (targeted by id, not DOM order)
const pointer = await pointerNode()
check('seed pointer node present', pointer !== null)
await page.dblclick(`.react-flow__node[data-id="${pointer.id}"]`)
await page.waitForTimeout(450)
check('drill-in from Home', (await crumbs(page)).length === 2)

// C — core loop: create, edit, persist
// No-auto-file: a picker-created node starts with NO file. The panel shows the
// empty state with a "Create file" button; clicking it mints untitled.md, after
// which the editor appears. (Pre no-auto-file the file existed implicitly.)
await createViaPicker(page, 'Poseidon hash', { x: 600, y: 400 })
const poseidon = await nodeByTitle('Poseidon hash')
check('picker created the node', poseidon !== null)
check('picker-created node has no file', poseidon.payload === undefined)
await page.click(`.react-flow__node[data-id="${poseidon.id}"]`)
await page.waitForSelector('.side-panel .panel-empty')
check('file-less panel shows the Create file empty state', (await page.$('.side-panel .cm-content')) === null)
await page.click('.side-panel .panel-empty button:has-text("Create file")')
await page.waitForSelector('.side-panel .cm-content', { timeout: 15000 })
check('Create file mints a file and reveals the editor', (await fileContentByTitle('Poseidon hash')) !== null)
await page.click('.side-panel .cm-content')
await page.keyboard.type('ZK commitment primitive')
await page.waitForTimeout(900)
await page.fill('[aria-label="Node summary"]', 'hash primitive')
await page.click('.panel-save-button')
await page.waitForTimeout(400)
await page.reload()
await page.waitForSelector('.react-flow__node')
check('payload + trail survive reload', (await fileContentByTitle('Poseidon hash')).includes('ZK commitment') && (await crumbs(page)).length === 2)
check('staged summary saved and survives reload', (await nodeByTitle('Poseidon hash')).summary === 'hash primitive')

// D — duplicate defense
await page.dblclick('.react-flow__pane', { position: { x: 300, y: 300 } })
await page.waitForSelector('.picker-input')
await page.fill('.picker-input', 'poseidon')
await page.waitForTimeout(150)
const firstRowIsExisting = await page.$eval(
  '.picker-rows button:first-child',
  (el) => !el.className.includes('picker-row--create'),
)
await page.press('.picker-input', 'Enter')
await page.waitForTimeout(300)
c = await counts()
check('existing-before-create, no duplicate', firstRowIsExisting && c.nodes === 2)

// E — edge gesture + cancel semantics
// The sidebar (248px) + open side panel (380px) leave the pane ~970px wide.
await createViaPicker(page, 'k-anonymity set', { x: 780, y: 600 })
const kanon = await nodeByTitle('k-anonymity set')
async function dragHandleTo(targetX, targetY) {
  const handle = await page.$(
    `.react-flow__node[data-id="${poseidon.id}"] .react-flow__handle[data-handlepos="right"]`,
  )
  const hBox = await handle.boundingBox()
  await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetX, targetY, { steps: 10 })
  await page.mouse.up()
}
const kanonBox = await (await page.$(`.react-flow__node[data-id="${kanon.id}"]`)).boundingBox()
await dragHandleTo(kanonBox.x + kanonBox.width / 2, kanonBox.y + kanonBox.height / 2)
await page.waitForSelector('.picker-input')
await page.press('.picker-input', 'Enter')
await page.waitForTimeout(300)
let edges = (await bundle()).edges
check('edge gesture: drop on node, Enter = relates to', edges.length === 1 && edges[0].fromNodeId === poseidon.id)
check('edge label rendered', (await page.$('.relation-edge-label')) !== null)

const beforeCancel = await counts()
await dragHandleTo(kanonBox.x + 420, kanonBox.y + 250)
await page.waitForSelector('.picker-input')
await page.press('.picker-input', 'Escape')
await page.waitForTimeout(200)
c = await counts()
check('Escape at node stage cancels all', c.nodes === beforeCancel.nodes && c.edges === beforeCancel.edges)
await dragHandleTo(kanonBox.x + 440, kanonBox.y + 280)
await page.waitForSelector('.picker-input')
await page.fill('.picker-input', 'ephemeral idea')
await page.waitForTimeout(120)
await page.press('.picker-input', 'Enter')
await page.waitForSelector('.picker-input')
await page.press('.picker-input', 'Escape')
await page.waitForTimeout(250)
c = await counts()
check('Escape at relation stage keeps node, no edge', (await nodeByTitle('ephemeral idea')) !== null && c.edges === beforeCancel.edges)

// F — drill-in / history / drill-out
await page.click(`.react-flow__node[data-id="${poseidon.id}"]`)
await drillIntoSelection(page)
check('Enter-drill created sub-graph', (await crumbs(page)).length === 3)
await page.goBack()
await page.waitForTimeout(400)
check('browser back restores trail', (await crumbs(page)).length === 2)
await page.goForward()
await page.waitForTimeout(400)
check('browser forward restores trail', (await crumbs(page)).length === 3)
await page.keyboard.press('Control+Shift+Comma')
await page.waitForTimeout(400)
check('drill-out to parent', (await crumbs(page)).length === 2)

// G — Mod+K teleport: lateral jump (from inside the sub-graph) resets the trail
await page.dblclick(`.react-flow__node[data-id="${poseidon.id}"]`)
await page.waitForTimeout(450)
check('re-drill into existing sub-graph needs no confirm', (await crumbs(page)).length === 3)
await page.keyboard.press('Control+k')
await page.waitForSelector('.picker-input')
await page.fill('.picker-input', 'k-anonymity')
await page.waitForTimeout(250)
await page.press('.picker-input', 'Enter')
await page.waitForTimeout(500)
const crumbsAfterJump = await crumbs(page)
check('Mod+K jump resets trail to one segment', crumbsAfterJump.length === 1, JSON.stringify(crumbsAfterJump))
const kanonSelected = await page.$(`.react-flow__node[data-id="${kanon.id}"].selected`)
check('jump focuses the node', kanonSelected !== null)
await page.keyboard.press('Control+Shift+Comma')
await page.waitForTimeout(400)
check('drill-out after lateral jump goes to the root', (await crumbs(page)).join('') === 'Default')

// H — Mod+K graph row opens the graph (click the row whose type label reads
// "graph" — the Home pointer NODE shares the name, so Enter's top hit is
// ambiguous by design; the graph row's .picker-row-type is the literal "graph")
await page.keyboard.press('Control+k')
await page.waitForSelector('.picker-input')
await page.fill('.picker-input', 'First graph')
await page.waitForTimeout(250)
const graphRow = await page.$('.picker-rows button:has(.picker-row-type:text-is("graph"))')
check('Mod+K lists graphs', graphRow !== null)
await graphRow.click()
await page.waitForTimeout(500)
check('graph row opens the graph', (await crumbs(page)).join('') === 'First graph')

// I — tags: add in panel, chip on card, Mod+K finds by tag
await page.click(`.react-flow__node[data-id="${poseidon.id}"]`)
await page.waitForSelector('.panel-tag-input')
await page.click('.panel-tag-input')
await page.keyboard.type('zk')
await page.keyboard.press('Enter')
await page.click('.panel-save-button')
await page.waitForTimeout(400)
check('tag chip appears on the card', (await page.$(`.react-flow__node[data-id="${poseidon.id}"] .node-card-tag`)) !== null)
await page.keyboard.press('Escape')
await page.keyboard.press('Control+k')
await page.waitForSelector('.picker-input')
await page.fill('.picker-input', 'zk')
await page.waitForTimeout(250)
const tagHit = await page.$$eval('.picker-rows button', (els) =>
  els.some((el) => el.textContent.includes('Poseidon hash')),
)
check('Mod+K finds by tag', tagHit)
await page.press('.picker-input', 'Escape')

// J — undo/redo: delete-everywhere then Mod+Z restores; text inputs keep native undo
const beforeDelete = await counts()
await page.click(`.react-flow__node[data-id="${poseidon.id}"]`)
await page.waitForSelector('.panel-delete-button')
await page.click('.panel-delete-button')
await page.waitForSelector('.confirm-dialog')
await page.keyboard.press('Enter')
await page.waitForTimeout(400)
c = await counts()
check('delete-everywhere cascades', c.nodes === beforeDelete.nodes - 1 && c.edges === beforeDelete.edges - 1)
await page.keyboard.press('Control+z')
await page.waitForTimeout(400)
c = await counts()
check('Mod+Z restores node, placements, edges', c.nodes === beforeDelete.nodes && c.edges === beforeDelete.edges)
await page.click(`.react-flow__node[data-id="${poseidon.id}"]`)
await page.waitForSelector('.panel-title-input')
await page.click('.panel-title-input')
await page.keyboard.press('Control+z')
await page.waitForTimeout(300)
c = await counts()
check('Mod+Z in a text input never fires structural undo', c.nodes === beforeDelete.nodes)
await page.keyboard.press('Escape')
await page.keyboard.press('Escape')

// K — vocab (Settings side-nav): rename updates edge labels live
await openSettings(page, 'Relation types')
let nameInput = null
for (const input of await page.$$('.settings-row:not(.settings-row--add) .ui-input')) {
  if ((await input.inputValue()) === 'relates to') nameInput = input
}
check('vocab panel lists the seeded type', nameInput !== null)
await nameInput.fill('links to')
await nameInput.press('Enter')
await page.waitForTimeout(300)
await closeSettings(page)
const labels = await page.$$eval('.relation-edge-label', (els) => els.map((e) => e.textContent))
check('relation-type rename updates edge labels', labels.includes('links to'), JSON.stringify(labels))

// L — loose ends in the sidebar tree: orphan a child graph + unplace a node, rescue both
const sub = (await bundle()).graphs.find((g) => g.name === 'Poseidon hash') ?? null
check('sub-graph exists for orphan test', sub !== null)
await page.click(`.react-flow__node[data-id="${poseidon.id}"]`)
await page.waitForSelector('.panel-delete-button')
await page.click('.panel-delete-button')
await page.waitForSelector('.confirm-dialog')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
await page.click(`.react-flow__node[data-id="${kanon.id}"]`)
await page.keyboard.press('Delete')
await page.waitForTimeout(300)
await page.keyboard.press('Control+Shift+Comma')
await page.waitForTimeout(400)
const treeText = await page.locator('.sidebar-pane', { hasText: 'Nodes' }).locator('.sidebar-pane-scroll').textContent()
check('tree groups list orphan graph + unplaced node', treeText.includes('Unlinked graphs') && treeText.includes('Poseidon hash') && treeText.includes('Unplaced nodes') && treeText.includes('k-anonymity set'), treeText.slice(0, 200))
await page.hover('.sidebar-row:has-text("Poseidon hash")')
await page.click('[aria-label="Link Poseidon hash into project root"]')
await page.waitForTimeout(400)
check('re-link creates a pointer on Home', (await nodeByTitle('Poseidon hash'))?.childGraphId === sub.id)
await page.hover('.sidebar-row:has-text("k-anonymity set")')
await page.click('[aria-label="Place k-anonymity set at project root"]')
await page.waitForTimeout(400)
const kanonPlacements = (await bundle()).placements.filter((p) => p.nodeId === kanon.id)
check('unplaced node re-placed on Home', kanonPlacements.length === 1)

// M — tree rows: folder under Home, leaf focus-jump, delete-graph fallback
check('tree shows the subgraph folder under Home', (await page.$('.sidebar-list--nested .sidebar-row:has-text("First graph")')) !== null)
await page.click(`.sidebar-list--nested .tree-leaf:text-is("k-anonymity set")`)
await page.waitForTimeout(600)
check('leaf click focuses the node on its graph', (await page.$(`.react-flow__node[data-id="${kanon.id}"].selected`)) !== null)
await page.click('.sidebar-list--nested .sidebar-row:has-text("First graph") .sidebar-item')
await page.waitForTimeout(400)
check('folder click visits with the tree path as trail', (await crumbs(page)).join('|') === 'Default|First graph')
await page.keyboard.press('Control+Shift+Comma')
await page.waitForTimeout(400)
await page.keyboard.press('Shift+Digit1') // fit view so the re-linked card is rendered
await page.waitForTimeout(400)
await page.dblclick(`.react-flow__node[data-id="${(await nodeByTitle('Poseidon hash')).id}"]`)
await page.waitForTimeout(450)
await page.hover('.sidebar-list--nested .sidebar-row:has-text("Poseidon hash")')
await page.click('[aria-label="Delete graph Poseidon hash"]')
await page.waitForSelector('.confirm-dialog')
await page.keyboard.press('Enter')
await page.waitForTimeout(500)
check('tree-row graph delete jumps back', (await crumbs(page)).join('') === 'Default')
check('graph deleted, childGraphId cleared', (await nodeByTitle('Poseidon hash')).childGraphId === undefined)

// P — export/import regression (full replace, via Settings → Data)
const downloadDir = mkdtempSync(join(tmpdir(), 'gnosis-smoke-'))
await openSettings(page, 'Data')
let downloadPromise = page.waitForEvent('download')
await page.click('[aria-label="Export workspace bundle"]')
const download = await downloadPromise
const bundlePath = join(downloadDir, download.suggestedFilename())
await download.saveAs(bundlePath)
await closeSettings(page)
await createViaPicker(page, 'after-export noise', { x: 500, y: 700 })
await openSettings(page, 'Data')
await page.setInputFiles('input[accept="application/json"]', bundlePath)
await page.waitForSelector('.confirm-dialog')
await page.keyboard.press('Enter')
await page.waitForTimeout(700)
await page.waitForSelector('.settings-modal', { state: 'detached', timeout: 10000 }).catch(() => {})
check('import replaces workspace', (await nodeByTitle('after-export noise')) === null && (await nodeByTitle('Poseidon hash')) !== null)

// R — bulk markdown import: 100 files, grid-placed in a new graph (§7)
const mdDir = mkdtempSync(join(tmpdir(), 'gnosis-md-'))
for (let i = 0; i < 100; i++) {
  const body =
    i % 3 === 0
      ? `---\ntitle: Note ${i}\ntags: [imported, batch]\n---\n\nBody of note ${i}.`
      : `# Note ${i}\n\nBody of note ${i}.`
  writeFileSync(join(mdDir, `note-${String(i).padStart(3, '0')}.md`), body)
}
const beforeImport = await counts()
await openSettings(page, 'Data')
page.once('dialog', (d) => void d.accept('Imported batch'))
await page.setInputFiles('input[webkitdirectory]', mdDir)
await page.waitForFunction(
  () => document.querySelector('.breadcrumbs-current')?.textContent === 'Imported batch',
  undefined,
  { timeout: 20000 },
)
await page.waitForSelector('.settings-modal', { state: 'detached', timeout: 5000 }).catch(() => {})
await page.waitForTimeout(800)
c = await counts()
check('bulk import: 100 nodes + placements in a new graph', c.nodes === beforeImport.nodes + 100 && c.placements === beforeImport.placements + 100 && c.graphs === beforeImport.graphs + 1)
check('import closed settings and jumped to the new graph', (await crumbs(page)).join('') === 'Imported batch')
const batchBundle = await bundle()
const batchGraph = batchBundle.graphs.find((g) => g.name === 'Imported batch') ?? null
const gridPlacements = batchBundle.placements
  .filter((p) => p.graphId === batchGraph.id)
  .map((p) => ({ id: p.id, x: p.x, y: p.y }))
check('grid: 10 columns at 340x190', gridPlacements.some((p) => p.x === 340 && p.y === 0) && gridPlacements.some((p) => p.x === 0 && p.y === 190))
check('frontmatter tags honored', batchBundle.nodes.filter((n) => n.tags.includes('imported')).length > 0)

// S — Tidy (top bar): one-shot elk layout, single Mod+Z restores the grid exactly (§5)
await page.click('.top-bar-actions [aria-label="Tidy layout"]')
const tidied = await (async () => {
  for (let i = 0; i < 100; i++) {
    const rows = (await bundle()).placements.filter((p) => p.graphId === batchGraph.id)
    const byId = new Map(gridPlacements.map((p) => [p.id, p]))
    if (rows.some((p) => { const prev = byId.get(p.id); return prev && (prev.x !== p.x || prev.y !== p.y) })) return true
    await page.waitForTimeout(200)
  }
  return false
})()
check('Tidy moved nodes (elk layered)', tidied)
await page.waitForTimeout(400)
await page.keyboard.press('Control+z')
await page.waitForTimeout(600)
const restored = (await bundle()).placements
  .filter((p) => p.graphId === batchGraph.id)
  .map((p) => ({ id: p.id, x: p.x, y: p.y }))
const restoredById = new Map(restored.map((p) => [p.id, p]))
check('single Mod+Z restores the grid exactly', gridPlacements.every((p) => {
  const r = restoredById.get(p.id)
  return r && r.x === p.x && r.y === p.y
}))

// T — LOD: far zoom renders no excerpts; zooming in reveals them (§5)
await page.keyboard.press('Shift+Digit1')
await page.waitForTimeout(500)
const farExcerpts = await page.$$eval('.node-card-excerpt', (els) => els.length)
check('far zoom: no payload excerpts', farExcerpts === 0, `count=${farExcerpts}`)
// Summarize one card here, then zoom toward it — only summaries render as excerpts.
const lodCardId = await page.$eval('.react-flow__node', (el) => el.getAttribute('data-id'))
await page.click(`.react-flow__node[data-id="${lodCardId}"]`)
await page.waitForSelector('[aria-label="Node summary"]')
await page.fill('[aria-label="Node summary"]', 'imported summary blurb')
await page.click('.panel-save-button')
await page.waitForTimeout(300)
await page.keyboard.press('Escape')
const lodCardBox = await (await page.$(`.react-flow__node[data-id="${lodCardId}"]`)).boundingBox()
await page.mouse.move(lodCardBox.x + lodCardBox.width / 2, lodCardBox.y + lodCardBox.height / 2)
for (let i = 0; i < 8; i++) {
  await page.mouse.wheel(0, -240)
  await page.waitForTimeout(80)
}
await page.waitForTimeout(400)
const nearExcerpts = await page.$$eval('.node-card-excerpt', (els) => els.map((e) => e.textContent))
check('near zoom: summary renders as the card excerpt', nearExcerpts.includes('imported summary blurb'), JSON.stringify(nearExcerpts))
check('cards without a summary show no content', nearExcerpts.every((t) => t === 'imported summary blurb'))

// U — exports: JSON Canvas from the top bar, markdown zip from Settings → Data
await page.keyboard.press('Shift+Digit1')
await page.waitForTimeout(400)
downloadPromise = page.waitForEvent('download')
await page.click('.top-bar-actions [aria-label="Export graph"]')
const canvasDownload = await downloadPromise
check('top-bar Export downloads JSON Canvas', /\.(canvas|zip)$/.test(canvasDownload.suggestedFilename()), canvasDownload.suggestedFilename())
await openSettings(page, 'Data')
downloadPromise = page.waitForEvent('download')
await page.click('[aria-label="Export markdown notes"]')
const mdDownload = await downloadPromise
check('markdown export downloads a zip', mdDownload.suggestedFilename().endsWith('.zip'))
await closeSettings(page)

// V — dashboard chrome: sidebar header/tree, collapse rail, info tips
check('tree root row shows the active project', (await page.$eval('.sidebar-item--root', (el) => el.textContent)) === 'Default')
check('active graph highlighted in the tree', (await page.$eval('.sidebar-item--active', (el) => el.textContent)) === 'Imported batch')
const nodesPane = page.locator('.sidebar-pane', { hasText: 'Nodes' })
const unlinkedText = await nodesPane.locator('.sidebar-pane-scroll').textContent()
check('imported graph appears under Unlinked', unlinkedText.includes('Unlinked graphs') && unlinkedText.includes('Imported batch'))
await page.click('.sidebar-nav-item[aria-label="Collapse sidebar"]')
check('sidebar collapses to a rail', (await page.$('.sidebar--collapsed')) !== null)
check('rail offers settings icon', (await page.$('.sidebar--collapsed [aria-label="Settings"]')) !== null)
await page.reload()
await page.waitForSelector('.react-flow__node')
check('collapse persists across reload', (await page.$('.sidebar--collapsed')) !== null)
await page.click('[aria-label="Expand sidebar"]')
await page.waitForTimeout(150)

const unlinkedSection = nodesPane.locator('.sidebar-section', { hasText: 'Unlinked graphs' })
await unlinkedSection.locator('.info-tip-button').hover()
await page.waitForTimeout(300)
check('info tip reveals on hover', (await unlinkedSection.locator('.info-tip-bubble').evaluate((el) => getComputedStyle(el).opacity)) === '1')

// Two panes (Nodes + Files), each with its own scroller — the workspace-management
// sidebar. The Files pane is a hierarchical tree of file-bearing nodes.
const paneLabels = await page.$$eval('.sidebar-pane-label', (els) => els.map((e) => e.textContent))
check('sidebar shows two panes: Nodes + Files', paneLabels.includes('Nodes') && paneLabels.includes('Files'), JSON.stringify(paneLabels))
const filesPane = page.locator('.sidebar-pane', { hasText: 'Files' })
// The two panes scroll independently: each owns a separate overflow:auto scroller.
const scrollerCount = await page.$$eval('.sidebar-pane .sidebar-pane-scroll', (els) =>
  els.filter((e) => getComputedStyle(e).overflowY === 'auto').length)
check('the two panes scroll independently (two auto scrollers)', scrollerCount === 2, `count=${scrollerCount}`)
check('sidebar offers a Docs button', (await page.$('.sidebar-nav-item:has-text("Docs")')) !== null)

// The Files pane only lists file-bearing nodes reachable from Home (it is a file
// viewer rooted at the project). The active "Imported batch" graph is unlinked,
// so its files don't show — go Home via the tree's root row and mint one with the
// pane's "+ New file" button (no-auto-file: a file node is opt-in), then assert it
// shows as a leaf under the (expanded) Home row in the hierarchical tree.
await nodesPane.locator('.sidebar-item--root').click()
await page.waitForTimeout(400)
check('root row navigates Home', (await crumbs(page)).join('') === 'Default')
await filesPane.locator('.sidebar-pane-action', { hasText: 'New file' }).click()
await page.waitForSelector('.doc-page', { timeout: 10000 })
await page.keyboard.press('Escape')
await page.waitForSelector('.react-flow__node')
await page.waitForTimeout(300)
check('+ New file mints a file-bearing node on Home', (await nodeByTitle('untitled'))?.payload?.kind === 'file')
// Expand the Home row in the Files pane so its leaves render.
const homeDisclosure = filesPane.locator('.tree-disclosure[aria-label="Expand Default"]')
if (await homeDisclosure.count()) await homeDisclosure.click()
const fileLeaf = filesPane.locator('.tree-leaf', { hasText: 'untitled.md' })
const leafShown = await fileLeaf
  .waitFor({ state: 'visible', timeout: 5000 })
  .then(() => true)
  .catch(() => false)
check('Files pane lists the new file as a tree leaf', leafShown)
check('Files pane is a hierarchical tree (nested lists)', (await filesPane.locator('.sidebar-list--nested').count()) > 0)

// Back to the imported batch (an Unlinked graph) for the payload + doc checks
// below. Navigate via the tree row — an in-session hash goto is unreliable.
await nodesPane.locator('.sidebar-section', { hasText: 'Unlinked graphs' }).locator('.sidebar-item', { hasText: 'Imported batch' }).first().click()
await page.waitForFunction(() => document.querySelector('.breadcrumbs-current')?.textContent === 'Imported batch', undefined, { timeout: 10000 })
await page.waitForSelector('.react-flow__node')
await page.waitForTimeout(400)
await page.click('.react-flow__node')
await page.waitForSelector('.panel-title-input')

// W — payload: edit/preview toggle, code format + language + linter
await page.click('.panel-view-switch >> text=preview')
// The prose container mounts before the lazy react-markdown chunk resolves — wait for output.
const prose = await page
  .waitForSelector('.panel-preview-prose p', { timeout: 10000 })
  .catch(() => null)
check('markdown preview renders prose', prose !== null)
// The filename drives the format (D2): renaming to .json detects code/json.
await page.click('.side-panel .ui-segment-option:text-is("data")')
await page.waitForSelector('.panel-filename-input')
check('data section offers the filename field', true)
await page.fill('.panel-filename-input', 'payload.json')
await page.press('.panel-filename-input', 'Enter')
await page.waitForTimeout(300)
await page.click('.panel-view-switch >> text=edit')
await page.waitForSelector('.side-panel .cm-content')
await page.click('.side-panel .cm-content')
await page.keyboard.press('Control+a')
await page.keyboard.type('{"a":1,"b":[1,2]}')
await page.waitForTimeout(900)
await page.click('.panel-view-switch >> text=preview')
await page.waitForTimeout(200)
const jsonPreview = await page.$eval('.panel-preview-code', (el) => el.textContent)
check('JSON preview pretty-prints', jsonPreview.includes('"a": 1'), jsonPreview.slice(0, 60))
const highlighted = await page
  .waitForSelector('.panel-preview-code [class*="tok-"]', { timeout: 10000 })
  .then(() => true)
  .catch(() => false)
check('preview gets syntax highlighting', highlighted)
await page.click('.panel-view-switch >> text=edit')
await page.waitForSelector('.side-panel .cm-content')
await page.click('.side-panel .cm-content')
await page.keyboard.press('Control+a')
await page.keyboard.type('{broken')
await page.waitForTimeout(1400)
check('JSON linter flags invalid JSON', (await page.$('.side-panel .cm-lintRange-error, .side-panel .cm-lintPoint-error')) !== null)
await page.keyboard.press('Escape')
await page.keyboard.press('Escape')

// Y — doc editor: toolbar, layouts, live preview, search, status bar, deep link
const note1 = await nodeByTitle('Note 1')
await page.keyboard.press('Shift+Digit1')
await page.waitForTimeout(400)
await page.click(`.react-flow__node[data-id="${note1.id}"]`)
await page.waitForSelector('[aria-label="Open in editor"]')
await page.click('[aria-label="Open in editor"]')
await page.waitForSelector('.doc-page')
check('doc page replaces the canvas', (await page.$('.react-flow')) === null && page.url().includes('#/d/'))
check('breadcrumbs append the doc title', (await crumbs(page)).at(-1) === 'Note 1')
check('canvas actions hidden on the doc page', (await page.$('.top-bar-actions')) === null)
await page.waitForSelector('.doc-split .cm-content', { timeout: 15000 })
const docProse = await page
  .waitForSelector('.doc-split .panel-preview-prose p', { timeout: 10000 })
  .catch(() => null)
check('markdown doc: editor and preview side by side', docProse !== null)
check('formatting toolbar present', (await page.$('.doc-toolbar')) !== null)
check('status bar starts saved', (await page.$eval('.doc-statusbar-save', (el) => el.textContent)) === 'saved')
await page.click('.doc-split .cm-content')
await page.keyboard.type('docsmoke ')
check('status bar flips to unsaved while a save pends', (await page.$eval('.doc-statusbar-save', (el) => el.textContent)) === 'unsaved')
// 400ms < the 500ms save debounce: pins the preview to the live document, not the store.
const previewFollows = await page
  .waitForFunction(
    () => document.querySelector('.doc-split .panel-preview-prose')?.textContent.includes('docsmoke'),
    undefined,
    { timeout: 400 },
  )
  .then(() => true)
  .catch(() => false)
check('preview follows typing before the debounced save', previewFollows)
const statusText = await page.$eval('.doc-statusbar', (el) => el.textContent)
check('status bar shows counts and cursor', /\d+ words/.test(statusText) && /\d+ chars/.test(statusText) && /Ln \d+, Col \d+/.test(statusText), statusText)
await page.keyboard.press('Control+a')
await page.click('.doc-toolbar button[title^="Bold"]')
let docText = await page.$eval('.doc-split .cm-content', (el) => el.textContent)
check('toolbar Bold wraps the selection', docText.startsWith('**') && docText.endsWith('**'), docText.slice(0, 20))
await page.keyboard.press('Control+b')
docText = await page.$eval('.doc-split .cm-content', (el) => el.textContent)
check('Mod+B shortcut unwraps it again', !docText.startsWith('**'), docText.slice(0, 20))
// Layout toggle CSS-hides panes (they stay mounted) — assert visibility, not presence.
await page.click('.doc-layout-switch >> text=write')
check('write layout hides the preview', await page.isHidden('.doc-split .panel-preview'))
await page.click('.doc-layout-switch >> text=preview')
check('preview layout hides the editor', await page.isHidden('.doc-split .cm-content'))
check('preview layout keeps the prose visible', await page.isVisible('.doc-split .panel-preview'))
await page.click('.doc-layout-switch >> text=split')
await page.click('.doc-split .cm-content')
await page.keyboard.press('Control+f')
const searchField = await page
  .waitForSelector('.cm-panel.cm-search input[name="search"]', { timeout: 5000 })
  .catch(() => null)
check('Mod+F opens search & replace', searchField !== null)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
check('Escape closes search, not the doc', (await page.$('.cm-panel.cm-search')) === null && (await page.$('.doc-page')) !== null)
await page.reload()
await page.waitForSelector('.doc-page')
check('doc deep-link survives reload', page.url().includes(`#/d/${note1.id}`))
await page.keyboard.press('Escape')
await page.waitForSelector('.react-flow')
check('Escape closes the doc back to its graph', page.url().includes('#/g/'))

// Y1 — code doc: gutters, edit/preview via visibility
await page.click('.react-flow__node')
await page.waitForSelector('[aria-label="Open in editor"]')
await page.click('[aria-label="Open in editor"]')
await page.waitForSelector('.doc-page .cm-content', { timeout: 15000 })
check('code doc shows gutters', await page.isVisible('.doc-page .cm-gutters'))
await page.click('.doc-view-switch >> text=preview')
check('code doc preview hides the editor pane', await page.isHidden('.doc-page .cm-content'))
await page.click('.doc-view-switch >> text=edit')
await page.keyboard.press('Escape')
await page.waitForSelector('.react-flow')

// Y2 — context menus: New graph on the project root, Add node on the canvas
page.once('dialog', (d) => d.accept('Ctx graph'))
await page.click('.sidebar-item--root', { button: 'right' })
await page.waitForSelector('.context-menu')
check('right-click on the project root opens a menu', true)
await page.click('.context-menu-item:has-text("New graph")')
await page.waitForTimeout(500)
check('menu New graph creates a subgraph of root and enters it', (await crumbs(page)).join('|') === 'Default|Ctx graph')
await page.click('.react-flow__pane', { button: 'right', position: { x: 500, y: 400 } })
await page.waitForSelector('.context-menu')
await page.click('.context-menu-item:has-text("Add node")')
await page.waitForSelector('.picker-input')
await page.fill('.picker-input', 'menunode')
await page.waitForTimeout(120)
await page.press('.picker-input', 'Enter')
await page.waitForSelector('.picker-input', { state: 'detached' })
await page.waitForTimeout(400)
check('menu Add node creates a node on the canvas', (await nodeByTitle('menunode')) !== null)
await page.click('.react-flow__pane', { button: 'right', position: { x: 200, y: 200 } })
await page.waitForSelector('.context-menu')
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
check('Escape closes the menu, not the view', (await page.$('.context-menu')) === null && (await page.$('.react-flow')) !== null)

// Y3 — top bar search
await page.click('.top-bar-search')
await page.waitForSelector('.picker-input')
check('top-bar Search opens the command picker', true)
await page.press('.picker-input', 'Escape')

// X — settings: side-nav categories, theme override
await openSettings(page)
check('settings opens on a side-nav category', (await page.$eval('.settings-nav-item--active', (el) => el.textContent)) === 'Appearance')
await page.click('.settings-rows >> text=Dark')
await page.waitForTimeout(200)
const dataTheme = await page.evaluate(() => document.documentElement.dataset.theme)
const appBg = await page.$eval('.app', (el) => getComputedStyle(el).backgroundColor)
// The cyberpunk-sakura theme paints dark --bg #0c0d12 (was #16171d pre-theme).
check('forced dark theme applies', dataTheme === 'dark' && appBg === 'rgb(12, 13, 18)', `${dataTheme} ${appBg}`)
check('forced dark reaches the canvas', (await page.$('.react-flow.dark')) !== null)
await page.click('.settings-rows >> text=System')
await page.waitForTimeout(200)
check('system theme clears the override', (await page.evaluate(() => document.documentElement.dataset.theme)) === undefined)
check('system theme restores the canvas mode', (await page.$('.react-flow.dark')) === null)
await closeSettings(page)

// Z — in-app docs viewer: Docs button opens the embedded site, Back returns
await page.click('.sidebar-nav-item:has-text("Docs")')
await page.waitForSelector('.docs-view .docs-frame', { timeout: 10000 })
check('Docs button opens the in-app docs viewer', page.url().includes('#/docs'))
await page.click('.docs-view-header button')
await page.waitForTimeout(300)
check('Back closes the docs viewer', (await page.$('.docs-view')) === null)

// RW — Reset workspace (Settings → Data): wipes everything to a clean seeded Home.
const beforeReset = await counts()
check('workspace is non-trivial before reset', beforeReset.nodes > 1 && beforeReset.graphs > 2)
await openSettings(page, 'Data')
await page.click('[aria-label="Reset workspace"]')
await page.waitForSelector('.confirm-dialog')
await page.keyboard.press('Enter')
await page.waitForSelector('.settings-modal', { state: 'detached', timeout: 10000 }).catch(() => {})
await page.waitForSelector('.react-flow__node')
await page.waitForTimeout(400)
const afterReset = await counts()
check('Reset wipes to a clean seeded Home (Home + root + one pointer node)',
  afterReset.graphs === 2 && afterReset.nodes === 1 && afterReset.placements === 1 && afterReset.edges === 0,
  JSON.stringify(afterReset))
check('Reset lands back on the project root', (await crumbs(page)).join('') === 'Default')

// Q — console hygiene
const realErrors = errors.filter((e) => !e.includes('React DevTools'))
check('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))

await browser.close()
console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? ': ' + failures.join(', ') : ''}`)
process.exit(failures.length ? 1 : 0)
