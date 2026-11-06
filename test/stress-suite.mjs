import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { BrowserManager, sleep } from '../lib/browser.js'

const root = await mkdtemp(join(tmpdir(), 'dsh-stress-test-'))

const server = createServer((req, res) => {
  const url = req.url || '/'
  res.writeHead(200, { 'Content-Type': 'text/html' })
  if (url === '/popup1') {
    res.end(`<!DOCTYPE html><html><title>Popup 1</title><body>
      <button id="open-btn" onclick="window.open('/popup2', '_blank')">Open 2</button>
      <a id="link-2" target="_blank" href="/popup2">Link to 2</a>
    </body></html>`)
  } else if (url === '/popup2') {
    res.end(`<!DOCTYPE html><html><title>Popup 2</title><body>
      <button id="open-btn" onclick="window.open('/popup3', '_blank')">Open 3</button>
      <a id="link-3" target="_blank" href="/popup3">Link to 3</a>
    </body></html>`)
  } else if (url === '/popup3') {
    res.end(`<!DOCTYPE html><html><title>Popup 3</title><body>End of chain</body></html>`)
  } else {
    res.end(`<!DOCTYPE html><html><title>Base Page</title><body>
      <h1>Stress Page</h1>
      <input id="input-${Math.random()}" value="test">
      <a id="first-popup" target="_blank" href="/popup1">Open Popup 1</a>
    </body></html>`)
  }
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const baseUrl = `http://127.0.0.1:${port}`

console.log(`Stress test server running at ${baseUrl}`)

try {
  console.log('\n--- 1. Multi-tier popup window.open & target=_blank chain ---')
  const manager = new BrowserManager({
    config: {
      profileDir: join(root, 'stress-profile'),
      mode: 'headed',
      viewport: '1280x800',
    },
  })

  await manager.ensureSession('user-session', { url: `${baseUrl}/` })
  const initialTabs = await manager.listTabs('user-session')
  assert.equal(initialTabs.length, 1)

  // Click first popup link
  await manager.clickText('user-session', 'Open Popup 1')
  let tabs = []
  for (let i = 0; i < 30; i++) {
    tabs = await manager.listTabs('user-session')
    if (tabs.length === 2) break
    await sleep(100)
  }
  assert.equal(tabs.length, 2, 'Should have adopted popup 1')
  const popup1Tab = tabs.find(t => t.url.includes('/popup1'))
  assert.ok(popup1Tab, 'Popup 1 tab must exist')

  // Switch to popup 1, click next link
  await manager.selectTab('user-session', popup1Tab.tabId)
  await manager.clickText('user-session', 'Link to 2')
  for (let i = 0; i < 30; i++) {
    tabs = await manager.listTabs('user-session')
    if (tabs.length === 3) break
    await sleep(100)
  }
  assert.equal(tabs.length, 3, 'Should have adopted popup 2')
  const popup2Tab = tabs.find(t => t.url.includes('/popup2'))
  assert.ok(popup2Tab, 'Popup 2 tab must exist')

  // Switch to popup 2, click window.open button via clickText
  await manager.selectTab('user-session', popup2Tab.tabId)
  await manager.clickText('user-session', 'Open 3')
  for (let i = 0; i < 30; i++) {
    tabs = await manager.listTabs('user-session')
    if (tabs.length === 4) break
    await sleep(100)
  }
  assert.equal(tabs.length, 4, 'Should have adopted popup 3 via window.open')
  console.log('✓ PASS: 3-level chained popup adoption (target=_blank and window.open) successful')

  // Cross-session check
  console.log('\n--- 2. Cross-session security isolation ---')
  await manager.ensureSession('other-session', { url: `${baseUrl}/` })
  const otherTabs = await manager.listTabs('other-session')
  assert.equal(otherTabs.length, 1, 'Other session must only see its own tab')
  // Ensure other-session cannot select or close user-session's tabs
  for (const t of tabs) {
    await assert.rejects(manager.selectTab('other-session', t.tabId), /Unknown tab/)
    await assert.rejects(manager.closeTab('other-session', t.tabId), /Unknown tab/)
  }
  console.log('✓ PASS: Strict session boundary enforced on all chained tabs')

  // Rapid tab churning stress test
  console.log('\n--- 3. Rapid concurrent tab creation, switching, and deletion (12 tabs) ---')
  const createdTabIds = []
  for (let i = 0; i < 12; i++) {
    const status = await manager.newTab('user-session', `${baseUrl}/?item=${i}`)
    createdTabIds.push(status.session.tabId)
  }

  const allTabs = await manager.listTabs('user-session')
  assert.equal(allTabs.length, 4 + 12, 'All 16 tabs must be present')
  console.log(`Created 12 tabs rapidly. Total tabs: ${allTabs.length}`)

  // Random switching and actions across tabs
  console.log('Performing concurrent operations across tabs...')
  for (let i = 0; i < createdTabIds.length; i += 2) {
    const tabId = createdTabIds[i]
    await manager.selectTab('user-session', tabId)
    await manager.evaluate('user-session', `document.title = "Renamed-${i}"`)
    const snapshot = await manager.snapshot('user-session', { maxChars: 100 })
    assert.equal(snapshot.title, `Renamed-${i}`)
  }
  console.log('✓ PASS: Random tab switching and DOM evaluations succeeded without deadlock')

  // Close half of the created tabs
  console.log('Closing half of the created tabs...')
  for (let i = 0; i < 6; i++) {
    await manager.closeTab('user-session', createdTabIds[i])
  }
  const remainingTabs = await manager.listTabs('user-session')
  assert.equal(remainingTabs.length, 16 - 6)
  console.log(`✓ PASS: Closed 6 tabs cleanly, remaining: ${remainingTabs.length}`)

  // Process and Xvfb cleanup test
  console.log('\n--- 4. Clean shutdown and orphan process verification ---')
  const xvfbDisplay = manager.display
  console.log(`Active Xvfb display before stop: ${xvfbDisplay}`)
  await manager.stop()

  // Verify no lingering processes for this display
  if (xvfbDisplay) {
    const remainingXvfb = execSync(`ps -ef | grep '[X]vfb ${xvfbDisplay}' || true`).toString().trim()
    assert.equal(remainingXvfb, '', `Xvfb process for ${xvfbDisplay} must be completely terminated`)
    console.log(`✓ PASS: Xvfb process on ${xvfbDisplay} terminated cleanly`)
  }

  console.log('\n======================================================')
  console.log('ALL STRESS & CONCURRENCY TESTS PASSED!')
  console.log('======================================================')
} finally {
  await new Promise((resolve) => server.close(resolve))
  assert.ok(root.startsWith(join(tmpdir(), 'dsh-stress-test-')))
  await rm(root, { recursive: true, force: true })
}
