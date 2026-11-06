# Design notes — current fork

Historical measurements and earlier trade-offs remain in [PITFALLS.md](PITFALLS.md). This document describes the fork, not the original single-tab architecture.

## Ownership and identity

One Chromium process and one persistent profile serve all conversations. Each conversation owns multiple page targets. `manager.tabs` maps target IDs to owned records; `manager.sessions` maps conversation IDs to their selected record. Tools derive the conversation from `exec.agent.id`; a requested `tabId` must belong to it.

AI and human share selection. Navigating with `newTab:true` preserves old pages. Popup adoption follows a known opener chain; unrelated targets are never assigned by guesswork. Closing the sidebar view does not close owned pages; closing an individual browser tab does. `browser_embedded_close` closes all pages in its conversation.

Page ownership is not account isolation: cookies and logins are deliberately shared. Process shutdown affects every conversation and loses unsaved page state. Cookies survive clean restart; full multi-tab session restoration is not implemented.

## Streams and input

A new page target is activated once for reliable injected input. Afterwards the hub arbitrates Chromium foreground ownership: the most recently focused visible panel receives `Page.startScreencast`. Other watching panels use screenshot polling; blurred connections do not get pollers. Document visibility also gates client decoding. A static page is seeded with a frame because it may not emit screencast updates.

JPEG frames and input JSON share an authenticated WebSocket on the Harness origin. This is remote rendering, not a local embedded browser or VNC. It has network/encoding latency and does not proxy native browser chrome or file dialogs.

Pointer mapping uses the reported page viewport, not the downscaled canvas bitmap. Messages carry the selected tab ID so stale input can be refused. Canvas backing dimensions change only when required. Every decoded `ImageBitmap` is closed in `finally`; `drawImage` copies pixels and does not consume its source. See [MEMORY-AUDIT.md](../MEMORY-AUDIT.md) for evidence and browser-specific limits.

## Sidebar integration

The sidebar type and keyed body/title seats share one ID and mount through declared slots. The tab is revealed on demand when its conversation has browser pages or a new human handover request. The watcher polls every 5 seconds while visible and 20 seconds while hidden. Multiple browser pages live inside that conversation's panel with a title strip and editable address.

Panel mount is not visibility: hidden retained components must release streaming work without deleting the browser targets. Human handover is conversation-scoped; pending requests keep the browser alive. The human enters credentials in the page, not in the conversation.

## Navigation and resource lifetime

Mutation queues protect short ownership changes; network navigation must not hold that queue. Status uses cached metadata during programmatic navigation and bounded renderer queries otherwise. Navigation currently has a 60-second budget; a slow server can still exceed it. On failure keep the target inspectable and do not silently discard earlier tabs.

Idle timeout is 60 minutes by default. Watched panels, pending handovers and heuristically detected dirty forms defer shutdown. `browser_embedded_tabs({keepAliveMinutes:0})` disables reaping; positive values override the host-wide in-process timeout. This is not a per-conversation pin. DOM checks cannot fully cover custom editors, iframe forms or completed-but-still-populated forms; explicit pins are appropriate for critical work.

Stop must clean up Chromium and Xvfb. Diagnostics use a rotating allowlisted JSONL stream rather than recording raw input, page bodies, credentials or query tokens.

## Composition and dependencies

The shipped bundle sets `lazyTools:false` and `idleShutdownMinutes:60`. Config still supports the upstream skill gate (`lazyTools:true`), but a `browser-use` skill must be supplied separately. There are 13 tools, including tab management.

CDP and the WebSocket server remain in-tree. The fork declares its required Harness tool/schema packages explicitly; it is not dependency-free. The package version remains inherited from upstream. Install this fork from its Git URL, not the upstream npm package, to get these changes.

## Verification limits

Unit/regression tests, real Chromium smoke tests, real one-minute idle cycles and live Harness UI checks cover distinct boundaries. Sequential tab churn is not proof of arbitrary concurrency. Short keepalive tests are not an overnight soak, and Linux Chromium RSS is not Windows Firefox GPU/shared-memory usage. Report actual measurements and failed checks; see [AGENTS.md](../AGENTS.md) and [LOCAL-SETUP.md](../LOCAL-SETUP.md).
