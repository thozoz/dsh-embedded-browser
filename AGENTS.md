# Agent guide — dsh-embedded-browser fork

This is [thozoz's fork](https://github.com/thozoz/dsh-embedded-browser) of [imroc/dsh-embedded-browser](https://github.com/imroc/dsh-embedded-browser). It runs one host Chromium with **multiple owned tabs per conversation**. AI and human share the selected tab and persistent login profile. Do not restore upstream's obsolete one-tab-only behavior.

## Read only what the task needs

- User-facing setup and tool overview: [README.md](README.md), [README.zh.md](README.zh.md).
- Fork changes, verification and limits: [LOCAL-SETUP.md](LOCAL-SETUP.md).
- Graphics resource investigation and measured limits: [MEMORY-AUDIT.md](MEMORY-AUDIT.md).
- Architecture: [references/DESIGN.md](references/DESIGN.md).
- Historical browser traps: [references/PITFALLS.md](references/PITFALLS.md).
- Publishing only: [references/RELEASING.md](references/RELEASING.md). The package version remains inherited from upstream; a Git push is not an npm release.

## Code map

| File | Responsibility |
|---|---|
| `lib/index.js` | Config, Host wiring, human broker, prompt, optional lazy tool gate |
| `lib/browser.js` | Chromium/Xvfb lifetime, navigation, page operations, idle protection |
| `lib/tabs.js` | Target ownership, opener-chain adoption, per-session mutation queues |
| `lib/cdp.js`, `lib/ws.js` | In-tree CDP client and WebSocket server |
| `lib/screencast.js` | Watched target, visible-panel capture, state/input transport |
| `lib/client.js` | Plain-JS sidebar, browser tab strip, editable address, canvas/input |
| `lib/tools.js` | 13 tools, session binding, optional `tabId`, `keepAliveMinutes` |
| `lib/routes.js`, `lib/human.js` | Authenticated HTTP/upgrade endpoints and human handover |
| `lib/diagnostics.js` | Bounded, allowlisted rotating JSONL diagnostics |
| `cordis.patch.yml` | Bundle row; ships `lazyTools:false`, `idleShutdownMinutes:60` |

## Contracts that must survive changes

1. Tools derive ownership from `exec.agent.id`; never add a caller-controlled `sessionId`. A `tabId` must belong to that session. Popup adoption follows a known opener, never an arbitrary unowned target.
2. UI and AI share selection. Optional `tabId` selects for both before acting. `newTab:true` **preserves** old pages. `browser_embedded_tabs close` closes one tab; `browser_embedded_close` closes all tabs in the conversation. Removing the sidebar surface must not dispose owned pages.
3. All conversations deliberately share cookies/logins, not page ownership. A process stop affects every conversation. Do not describe page isolation as account isolation.
4. Only the stream hub owns ongoing foreground arbitration; activation once at target creation is still needed for reliable input. Emulation is per target; fresh tabs do not inherit overrides.
5. Do not hold the session mutation queue across slow network navigation. Status must remain bounded and use cached metadata during navigation; do not pile up `Runtime.evaluate` calls.
6. Idle timeout defaults to 60 minutes. Watched panels, pending human handover and detected dirty forms prevent reaping. `keepAliveMinutes` is a **host-wide in-process override**, not a per-tab lease; `0` disables reaping. Dirty detection is heuristic, not a guarantee for every editor/iframe. Stop loses tab/form state; persistent cookies remain.
7. Every decoded `ImageBitmap` must be closed in `finally`, including draw errors and asynchronous unmounts. `drawImage` does not consume it. Only resize a canvas when dimensions actually change. Hidden documents must not decode frames; blurred connections must not keep screenshot pollers.
8. Input coordinates use the reported page viewport, not the possibly downscaled frame. Reject stale tab input; send viewport changes promptly.
9. Canonical tool results must be lossless JSON. Keep the bounded serializer for page evaluation.
10. Declare Cordis injections. Wait for optional services with `ctx.inject`; attach Host metadata to the default function (`apply.inject`, `apply.Config`). Register Client keyed body/title under the same tab-type ID through `slots.inject`.
11. Effects own all timers/listeners/sockets/observers. A view hiding/unmounting must stop its work. Stop and unexpected browser exit must release Xvfb.
12. No page text, input, passwords, cookie values or URL query tokens in diagnostic logs. Keep log rotation and its field allowlist.

## Verification

```sh
npm test                 # lazy gate, diagnostics privacy, frame lifetime, real Chromium smoke, tabs
npm run test:full        # adds stress and real-clock idle tests; several minutes
node --check lib/client.js
```

- `test/frame-lifetime.mjs`: extracted production paint callback; close/resize/error/unmount/hidden regression.
- `test/tabs.mjs`: ownership, popup/link adoption, form retention and status during slow loads.
- `test/stress-suite.mjs`: popup chains, isolation, rapid tab churn and Xvfb teardown. Operations are mostly sequential; do not call it proof of arbitrary concurrent safety.
- `test/keepalive-idle.mjs`: real one-minute cycles for clean, dirty, watched, pending-human and disabled-reaping paths. A short disabled-reaping observation is not proof of infinite uptime, nor a real one-hour test.
- `test/live-tabs.mjs`, `test/live-ui.mjs`: require an authenticated running GUI plus `BROWSER_CDP_PORT` and `GUI_ORIGIN`; preserve user state and report failures honestly.
- `test/memory-observe.mjs`: 180s live bitmap/RSS observation; see audit caveats. Linux Chromium results do not establish Windows Firefox GPU-memory behavior.

Host module edits may stay cached: use the supported plugin-manager reload/restart path, inspect its result, and coordinate before terminating active pages. Client changes need a new served revision/page refresh; only promise HMR after observing it. Never edit Harness core, global packages or profile manifests to compensate for plugin defects.

## Scope and publishing

Keep changes minimal, tests beside nontrivial logic, and commits scoped. Do not add a build step: Client JavaScript loads through the existing module factory. CDP/WebSocket implementations stay in-tree; the fork also declares its required Harness schema/tool packages in `package.json` (the old zero-runtime-dependencies claim is no longer true).

Keep English/Chinese user docs aligned. Never commit credentials, browser profiles, personal page content or raw sensitive captures. Machine-specific historical reports are evidence, not portable configuration. For PRs, separate portable fixes from deployment-specific changes. Do not publish, retag, rewrite history or push upstream without an explicit request.
