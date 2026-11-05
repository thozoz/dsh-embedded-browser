# Local installation and verification

Installed from https://github.com/imroc/dsh-embedded-browser into this checkout, linked to the current Harness web profile using plugin_manager. Harness version: 0.2.1-alpha.3. No Harness core, global npm installation, Better Sidebar source, or Camofox configuration was edited.

## Local changes

- Declare missing runtime dependencies: @deepseek-ai/schemastery 3.18.5 and @deepseek-ai/dsh-tools 0.2.1-alpha.3. Installed only in this plugin checkout; lockfile retained.
- Set lazyTools:false in this bundle: this profile has no browser-use skill. Adjust the plugin prompt accordingly.
- Fix primary button contrast using host foreground/background tokens; verified in light and dark mode.
- Wait for Chromium target removal after Target.closeTarget to fix a real startup-cleanup race caught by upstream smoke tests.
- Add English/Turkish inventory metadata and an original SVG browser icon.
- Add test/live-ui.mjs, taking BROWSER_CDP_PORT and GUI_ORIGIN from the environment, for a running authenticated GUI.

## System prerequisites installed

Debian Chromium 156.0.8078.79, Xvfb, xauth, Liberation fonts and Noto emoji fonts. Chromium runs headed on private Xvfb with its standard sandbox (no --no-sandbox override added).

## Verification

- Upstream lazy-gate tests: 22/22 passed.
- Upstream real Chromium smoke tests: 66/66 passed after startup race fix. Covers DOM selection, typing, screenshots, session isolation, canvas-stream protocol, hand-over and login persistence across browser restart.
- Live model-facing status, navigation, DOM snapshot, JS evaluation, screenshot and human-handover tools exercised successfully.
- Existing public Harness GUI opened in the plugin browser; user completed authentication. Authentication survived browser/plugin reactivation.
- Better Sidebar and the native Browser tab coexist with no source changes to Better Sidebar.
- Live GUI canvas rendered and real mouse input dispatched to that canvas successfully changed the underlying GUI; state restored.
- Reply/Done buttons: light background rgb(15,17,21), foreground rgb(255,255,255); dark background rgb(249,250,251), foreground rgb(21,21,23).
- Automated Done click resolved actual hand-over. No renderer exceptions during that test.
- Live health endpoint: ok:true, version:0.3.0, running:true, mode:headed, executable:/usr/bin/chromium.
- Plugin inventory title/description and loaded custom icon verified in the actual GUI.
- Relevant system journal checked; this deployment does not emit plugin runtime console lines into that journal during hot activation, so no positive log-only claim is made. Actual health/tools/UI provide runtime evidence.

## Multi-tab update

Rollback baseline: 1607f17. Feature commits are separate from this baseline.

- One conversation now owns multiple Chromium page targets. UI and AI use the same selected tab, rather than separate hidden selections.
- browser_embedded_tabs lists/new/selects/closes owned targets. Page tools accept optional tabId, selecting it before acting. browser_embedded_navigate newTab:true preserves old tabs.
- Browser strip has titles, +, individual ×, editable address input (Enter), and panel-focused Ctrl/Cmd+L/T/W.
- Right-click on an HTML link opens it in a new selected tab directly (not a full native context menu). Ctrl/Cmd-click and middle-click on HTML links also open a new selected tab.
- Chromium popups with a known opener target are adopted into that opener's conversation and selected. Unrelated/unowned targets are intentionally never guessed into a conversation.
- Stream switching follows the selected target; stale panel input carrying a previous tabId is rejected.
- Last-tab close leaves the panel empty; legacy browser_embedded_close still closes all tabs in the conversation.

Verification: upstream 22 lazy-gate + 66 Chromium smoke checks; additional test/tabs.mjs covers form retention, new tabs, selection, opener popups, cross-conversation rejection, context/Ctrl links, stale input, cleanup. test/live-tabs.mjs verifies the actual authenticated Harness UI +, address editing/Enter, select, ×, Ctrl+T/W/L and renderer exceptions.

Limits: browser-reserved shortcuts may be intercepted by the outer browser, so use +/×/address controls in that case. A full native context menu is not streamed; right-click on a link is a direct new-tab action. Cross-origin iframe link hit-testing and popups with no provable opener are not automatically assigned. Tabs/page state are not restored across host restart; cookies remain persistent (existing behavior). Real email registration and third-party CAPTCHA flows are not used as regression tests.

## Diagnostics and navigation/lag fixes

- Rotating privacy-safe JSONL diagnostics log added at `$DSH_HOME/embedded-browser/logs/diagnostics.jsonl` (records CDP command latencies/timeouts, pending queue depth, document response status/TTFB, renderer crashes, host memory/event-loop lag, and panel long-task/error counts; strips page content, inputs, cookies, and query strings).
- Prevented `status()` and `ScreencastHub.pushState()` from blocking on `inSession` or piling up 30s `Runtime.evaluate` calls while a tab is mid-navigation (`record.page.navigating` skips `Runtime.evaluate` and uses a 1.2s timeout fallback).
- Extended default navigation budget (`waitMs`) from 30s to 60s (with 75s tool timeout) for slow authenticated backends (e.g., DocDrift `/app/home` taking ~45s TTFB when logged in), and abort stuck loads with `Page.stopLoading` on timeout while preserving existing tabs and selection.
- Fixed `Xvfb` child process cleanup on both `stop()` and `chrome.on('exit')`.
- Disabled automatic 10-minute `idleShutdownMinutes` reaping (`default(0)`) and prevented any configured idle timer from reaping while a panel is watching (`watchedSessionId !== undefined`).

## Use

Ask the AI to open a URL using browser_embedded_navigate. Right sidebar → Browser/Embedded browser. Click directly on its page to use mouse/keyboard. AI uses browser_embedded_ask_human for logins or other human-only steps.

The persistent browser profile is shared across conversations: logged-in accounts are available to every session. It is separate from Camofox. No personal account login or CAPTCHA success is guaranteed for every website. Do not overwrite these local fixes with an upstream pull without reviewing the diff.
