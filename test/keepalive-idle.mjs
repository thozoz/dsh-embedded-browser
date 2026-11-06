import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserManager, sleep } from '../lib/browser.js'

const root = await mkdtemp(join(tmpdir(), 'dsh-keepalive-test-'))
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(`<!DOCTYPE html><html><head><title>Form Test</title></head><body>
    <form id="test-form">
      <input id="text-in" name="username" value="default-val">
      <input type="checkbox" id="check-in" name="opt">
      <textarea id="area-in"></textarea>
      <div id="editable" contenteditable="true"></div>
    </form>
  </body></html>`)
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const baseUrl = `http://127.0.0.1:${port}`

console.log(`Test server running at ${baseUrl}`)

try {
  // Test 1: Clean page shuts down after ~65s when keepAliveMinutes = 1
  console.log('\n--- Test 1: Clean tab shuts down after 1 minute idle ---')
  let pendingHuman = false
  const manager1 = new BrowserManager({
    config: {
      profileDir: join(root, 'profile1'),
      mode: 'headless',
      viewport: '1000x700',
      idleShutdownMinutes: 1,
    },
    hasPendingHuman: () => pendingHuman,
  })

  await manager1.ensureSession('sess-1', { url: `${baseUrl}/` })
  assert.equal(manager1.keepAliveMinutes(), 1)
  assert.equal((await manager1.status('sess-1')).running, true)
  console.log('Browser started. Waiting 68 seconds for idle shutdown...')
  
  // Wait in small slices to observe
  for (let i = 0; i < 14; i++) {
    await sleep(5000)
    process.stdout.write('.')
  }
  console.log('')

  const status1 = await manager1.status('sess-1')
  assert.equal(status1.running, false, 'Browser should have stopped automatically after 1 minute')
  console.log('✓ PASS: Browser stopped automatically when clean and idle for 1 minute')
  await manager1.stop()

  // Test 2: Dirty form prevents shutdown
  console.log('\n--- Test 2: Dirty form prevents shutdown at 1 minute ---')
  const manager2 = new BrowserManager({
    config: {
      profileDir: join(root, 'profile2'),
      mode: 'headless',
      viewport: '1000x700',
      idleShutdownMinutes: 1,
    },
    hasPendingHuman: () => false,
  })

  await manager2.ensureSession('sess-2', { url: `${baseUrl}/` })
  // Modify an input to make it dirty
  await manager2.evaluate('sess-2', `document.getElementById('text-in').value = 'user-typed-something'`)
  assert.equal(await manager2.hasDirtyForms(), true, 'Form must be detected as dirty')

  console.log('Waiting 68 seconds with dirty form...')
  for (let i = 0; i < 14; i++) {
    await sleep(5000)
    process.stdout.write('.')
  }
  console.log('')

  const status2 = await manager2.status('sess-2')
  assert.equal(status2.running, true, 'Browser must NOT stop when forms have unsaved changes')
  console.log('✓ PASS: Dirty form successfully prevented idle shutdown!')

  // Now clean the form and verify it shuts down after another cycle
  console.log('Cleaning form and verifying it can shut down now...')
  await manager2.evaluate('sess-2', `document.getElementById('text-in').value = 'default-val'`)
  assert.equal(await manager2.hasDirtyForms(), false, 'Form must be clean now')
  // Touch to reset idle timer
  manager2.touch()

  for (let i = 0; i < 14; i++) {
    await sleep(5000)
    process.stdout.write('.')
  }
  console.log('')

  const status2Clean = await manager2.status('sess-2')
  assert.equal(status2Clean.running, false, 'Browser should stop after form is cleaned')
  console.log('✓ PASS: Cleaned form allowed idle shutdown')
  await manager2.stop()

  // Test 3: Watched session (user viewing sidebar) prevents shutdown
  console.log('\n--- Test 3: Watched panel prevents shutdown ---')
  const manager3 = new BrowserManager({
    config: {
      profileDir: join(root, 'profile3'),
      mode: 'headless',
      viewport: '1000x700',
      idleShutdownMinutes: 1,
    },
    hasPendingHuman: () => false,
  })

  await manager3.ensureSession('sess-3', { url: `${baseUrl}/` })
  manager3.setWatched('sess-3')

  console.log('Waiting 68 seconds with active watched session...')
  for (let i = 0; i < 14; i++) {
    await sleep(5000)
    process.stdout.write('.')
  }
  console.log('')

  const status3 = await manager3.status('sess-3')
  assert.equal(status3.running, true, 'Watched session must prevent idle shutdown')
  console.log('✓ PASS: Watched session prevented idle shutdown!')
  await manager3.stop()

  // Test 4: Pending human takeover prevents shutdown
  console.log('\n--- Test 4: Pending human action prevents shutdown ---')
  let isHumanWaiting = true
  const manager4 = new BrowserManager({
    config: {
      profileDir: join(root, 'profile4'),
      mode: 'headless',
      viewport: '1000x700',
      idleShutdownMinutes: 1,
    },
    hasPendingHuman: () => isHumanWaiting,
  })

  await manager4.ensureSession('sess-4', { url: `${baseUrl}/` })

  console.log('Waiting 68 seconds while human action is pending...')
  for (let i = 0; i < 14; i++) {
    await sleep(5000)
    process.stdout.write('.')
  }
  console.log('')

  const status4 = await manager4.status('sess-4')
  assert.equal(status4.running, true, 'Pending human action must prevent idle shutdown')
  console.log('✓ PASS: Pending human request prevented idle shutdown!')
  await manager4.stop()

  // Test 5: keepAliveMinutes override to 0 (infinite)
  console.log('\n--- Test 5: keepAliveMinutes = 0 prevents shutdown indefinitely ---')
  const manager5 = new BrowserManager({
    config: {
      profileDir: join(root, 'profile5'),
      mode: 'headless',
      viewport: '1000x700',
      idleShutdownMinutes: 1, // configured as 1 min, but will override to 0
    },
    hasPendingHuman: () => false,
  })

  await manager5.ensureSession('sess-5', { url: `${baseUrl}/` })
  manager5.setKeepAliveMinutes(0)
  assert.equal(manager5.keepAliveMinutes(), 0)

  console.log('Waiting 68 seconds with keepAliveMinutes = 0...')
  for (let i = 0; i < 14; i++) {
    await sleep(5000)
    process.stdout.write('.')
  }
  console.log('')

  const status5 = await manager5.status('sess-5')
  assert.equal(status5.running, true, 'keepAliveMinutes = 0 must disable idle shutdown completely')
  console.log('✓ PASS: keepAliveMinutes = 0 kept browser alive!')
  await manager5.stop()

  console.log('\n======================================================')
  console.log('ALL KEEPALIVE & IDLE SHUTDOWN TESTS PASSED (5/5)')
  console.log('======================================================')
} finally {
  await new Promise((resolve) => server.close(resolve))
  assert.ok(root.startsWith(join(tmpdir(), 'dsh-keepalive-test-')))
  await rm(root, { recursive: true, force: true })
}
