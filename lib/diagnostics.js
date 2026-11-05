import { mkdirSync, appendFileSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** Small rotating JSONL log. Never accept raw page content, CDP params or input. */
export function createDiagnostics() {
  const directory = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'embedded-browser', 'logs')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, 'diagnostics.jsonl')
  const allowed = new Set(['method','ms','pending','sessionId','tabId','event','code','signal','count','rssMB','heapMB','lagMs','messageType','kind','origin'])
  return {
    path,
    write(event, fields = {}) {
      try {
        const safe = Object.fromEntries(Object.entries(fields).filter(([key]) => allowed.has(key)))
        for (const key of Object.keys(safe)) if (typeof safe[key] === 'string') safe[key] = safe[key].slice(0,160)
        try { if (statSync(path).size > 2 * 1024 * 1024) renameSync(path, path + '.1') } catch {}
        appendFileSync(path, JSON.stringify({ time: new Date().toISOString(), event, ...safe }) + '\n', { mode: 0o600 })
      } catch { /* logging must never take the browser down */ }
    },
  }
}
