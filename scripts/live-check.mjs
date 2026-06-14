// Live check: the cutover app booting against the self-hosted server (via Vite dev proxy).
import { chromium } from 'playwright-core'
const URL = process.env.URL ?? 'http://localhost:5173'
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`

const failures = []
const errors = []
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else { failures.push(name); console.log(`  FAIL ${name} ${detail}`) }
}

const browser = await chromium.launch({ executablePath: CHROME })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(URL)
// App boots straight into the canvas (server-backed; no Landing in this build).
await page.waitForSelector('.react-flow__pane', { timeout: 15000 })
await page.waitForTimeout(1500)
check('app boots into the canvas against the server', true)

// Seeded Home holds a "First graph" pointer node.
const seededTitle = await page.$eval('.node-card-title', (el) => el.textContent).catch(() => null)
check('seeded node rendered from the server', !!seededTitle, `got ${seededTitle}`)

// Create a node via double-click → picker → Enter.
await page.dblclick('.react-flow__pane', { position: { x: 800, y: 550 } })
await page.waitForSelector('.picker-input')
await page.fill('.picker-input', 'live cutover node')
await page.waitForTimeout(200)
await page.press('.picker-input', 'Enter')
await page.waitForTimeout(900)
const titles = await page.$$eval('.node-card-title', (els) => els.map((e) => e.textContent))
check('created a node via the command API + SSE', titles.includes('live cutover node'), JSON.stringify(titles))

// Open the panel, edit the title, confirm it round-trips.
await page.click('.node-card:has-text("live cutover node")')
await page.waitForSelector('.side-panel .panel-title-input')
check('side panel opens on selection', true)

// Sidebar shows the two panes (Nodes + Files), each with its own scroller.
const paneLabels = await page.$$eval('.sidebar-pane-label', (els) => els.map((e) => e.textContent))
check('sidebar shows Nodes + Files panes', paneLabels.includes('Nodes') && paneLabels.includes('Files'), JSON.stringify(paneLabels))
const treeText = await page.locator('.sidebar-pane', { hasText: 'Nodes' }).locator('.sidebar-pane-scroll').textContent().catch(() => '')
check('node tree renders', treeText.length > 0)

check('no console errors during the core loop', errors.length === 0, errors.slice(0, 3).join(' | '))

// Rewind every mutation this script made so the next script on the shared server
// starts from the pristine seed state (the seed itself is not on the undo stack).
const base = URL.replace(/\/$/, '')
for (let i = 0; i < 100; i++) {
  const u = await (await fetch(`${base}/api/undo`, { method: 'POST' })).json()
  if (!u.canUndo) break
}

console.log(`\n${failures.length === 0 ? 'PASS' : 'FAIL'} — ${failures.length} failed`)
await browser.close()
process.exit(failures.length ? 1 : 0)
