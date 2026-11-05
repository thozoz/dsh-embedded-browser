/** Session-owned Chromium targets. The selected record is shared by AI and panel. */
export function installTabs(manager) {
  manager.tabs = new Map()
  manager.tabQueues = new Map()
}

export async function inSession(manager, sessionId, operation) {
  const previous = manager.tabQueues.get(sessionId) ?? Promise.resolve()
  const task = previous.catch(() => {}).then(operation)
  manager.tabQueues.set(sessionId, task)
  try { return await task } finally {
    if (manager.tabQueues.get(sessionId) === task) manager.tabQueues.delete(sessionId)
  }
}

export function ownTab(manager, sessionId, tabId) {
  const tab = manager.tabs.get(tabId)
  if (!tab || tab.id !== sessionId) throw new Error('Unknown tab for this session; list tabs again')
  return tab
}

export async function registerTab(manager, sessionId, page, { url = 'about:blank', label, select = true } = {}) {
  await page.enable()
  await manager.applyEmulation(page, manager.defaultEmulation())
  await manager.cdp.activate(page.targetId)
  const record = { id: sessionId, tabId: page.targetId, targetId: page.targetId, page, url, label,
    title: '', createdAt: Date.now(), lastUsedAt: Date.now(), emulation: manager.defaultEmulation() }
  manager.tabs.set(record.tabId, record)
  if (select || !manager.sessions.has(sessionId)) manager.sessions.set(sessionId, record)
  page.on('Page.frameNavigated', ({ frame }) => {
    if (frame.parentId) return
    record.url = frame.url
    manager.onEvent({ type: 'tab-navigated', sessionId })
  })
  manager.touch()
  manager.onEvent({ type: 'tab-created', sessionId })
  return record
}

export async function refreshTabs(manager, sessionId) {
  if (!manager.cdp) return []
  const { targetInfos } = await manager.cdp.send('Target.getTargets')
  const targets = targetInfos.filter(t => t.type === 'page').map(t => ({ ...t, id: t.targetId }))
  // Follow the opener chain, never adopt an unrelated target from another session.
  for (let pass = 0; pass < targets.length; pass++) {
    let added = false
    for (const target of targets) {
      if (manager.tabs.has(target.id) || !target.openerId) continue
      const owner = manager.tabs.get(target.openerId)
      if (!owner || owner.id !== sessionId) continue
      await registerTab(manager, sessionId, await manager.cdp.attach(target.id), { url: target.url })
      added = true
    }
    if (!added) break
  }
  const live = new Map(targets.map(t => [t.id, t]))
  for (const record of [...manager.tabs.values()]) {
    if (record.id !== sessionId) continue
    const target = live.get(record.tabId)
    if (!target) {
      manager.tabs.delete(record.tabId)
      if (manager.sessions.get(sessionId) === record) {
        const fallback = [...manager.tabs.values()].find(t => t.id === sessionId)
        if (fallback) manager.sessions.set(sessionId, fallback)
        else manager.sessions.delete(sessionId)
        manager.onEvent({ type: 'tab-selected', sessionId })
      }
    } else { record.url = target.url; record.title = target.title }
  }
  return [...manager.tabs.values()].filter(t => t.id === sessionId).map(t => ({
    tabId: t.tabId, url: t.url, title: t.title, selected: manager.sessions.get(sessionId) === t,
  }))
}
