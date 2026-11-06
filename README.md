# dsh-embedded-browser

**English** | [简体中文](README.zh.md)

A browser that lives inside the DSH host: every DSH session gets **its own tabs** in it, the AI drives that tab with `browser_embedded_*` tools, and you watch — or take over — the very same tab in a **right-sidebar tab that opens on demand** in the DSH Web UI.

> **Community fork:** [thozoz/dsh-embedded-browser](https://github.com/thozoz/dsh-embedded-browser), based on [imroc’s upstream](https://github.com/imroc/dsh-embedded-browser). Includes multiple tabs, editable address bar, smart idle protection and explicit graphics-resource cleanup. The inherited package version is not a new npm release. Tested locally with DSH `0.2.1-alpha.3`; the inherited minimum-version range is not proof of compatibility with every release.

> **Renamed in 0.3.0.** Up to 0.2.0 this plugin was `dsh-browser-panel`: its tools were `browser_panel_*`, its routes lived under `/api/dsh-browser-panel/*`, and its profile under `$DSH_HOME/browser-panel/profile`. The package, the repository and every one of those names changed together, so the tool prefix now matches the package name. Point `profileDir` at the old directory if you want to keep the logins of an 0.2.0 install.

It exists for one stubborn problem: agents run on machines with no display, but the sites they need are behind a login. A headless browser can be scripted; it cannot scan a QR code, type an SMS code, or solve a CAPTCHA. With this plugin the human does that part **inside the DSH Web UI**, on the same tab the AI is already working on, and the result stays in a persistent profile — so a login performed once works in every session, now and after a restart.

## The problem

- An agent host (container, VM, CI box) has no GUI, so it cannot show you a login page.
- Fully headless automation breaks at the first step that needs a person: SSO redirects, one-time passcodes, QR-code logins, CAPTCHAs, hardware keys.
- Copying cookies or `storageState` into the container is fragile: device-bound credentials, fingerprints, and WebAuthn simply do not transfer.

## What it does

**One browser, multiple owned tabs per session, two control planes.** The AI speaks CDP on its own tab; the human sees and drives that same tab from the sidebar tab that mirrors it. The login the human performs is exactly the session the AI keeps using — and because all sessions share one profile, every other session is logged in too.

### Tools (published lazily)

This fork provides **13 tools**. The shipped bundle sets `lazyTools: false`, so they are available immediately; no `browser-use` skill is required. If you explicitly enable `lazyTools: true`, the optional upstream gate publishes them after a successful `browser-use` skill invocation, a `/browser-use` gesture, or replay of a successful invocation. The gate is host-wide for the running process.

| Capability | Tool | Notes |
|---|---|---|
| Report state | `browser_embedded_status` | Running? Which URL/title has *this session's* tab? Is a human action pending? |
| Open a URL | `browser_embedded_navigate` | Starts the browser on first use; `newTab: true` opens and selects a new tab without discarding existing pages |
| Read the page | `browser_embedded_snapshot` | Title, URL, numbered inventory of clickable/typable elements, visible text |
| Click | `browser_embedded_click` | By element number or by visible text; real input events |
| Fill a field | `browser_embedded_type` | React/Vue-friendly insertion; `submit` presses Enter |
| Press a key | `browser_embedded_press` | Enter, Tab, Escape, arrows, PageUp/Down, … |
| Scroll | `browser_embedded_scroll` | down/up/left/right/top/bottom |
| **Change the environment** | `browser_embedded_emulate` | Device preset (7 of them, `iphone-14` …), explicit viewport (`width`+`height`), or light/dark (`theme`); `reset: true` restores the default |
| **Evaluate in the page** | `browser_embedded_eval` | Runs JavaScript in this session's page and returns a bounded JSON projection (switch a theme attribute, read computed styles, assert on state) |
| Look at the page | `browser_embedded_screenshot` | PNG returned to the model as an image attachment |
| **Ask the human** | `browser_embedded_ask_human` | Brings up *this session's* browser tab with your instruction and **waits** until they press 我已完成 |
| Manage tabs | `browser_embedded_tabs` | `list`, `new`, `select`, `close`; optional `keepAliveMinutes` |
| Close all session tabs | `browser_embedded_close` | Closes every tab owned by this conversation; the profile stays |

`browser_embedded_emulate` is **per tab** and temporary: it changes no configuration, needs no restart, and cannot touch another session. `reset: true` returns the tab to the `viewport` the config pins. The preset names, dimensions, DPR and user agents are mirrored field for field from the BrowserSkill channel's `bsk emulate --device`, so "the same device" means the same page on either channel. Checking what a page looks like on a phone, and in the dark, is these two calls:

```
browser_embedded_emulate  { "device": "iphone-14" }   →  browser_embedded_screenshot
browser_embedded_emulate  { "theme": "dark" }         →  browser_embedded_screenshot
browser_embedded_emulate  { "reset": true }
```

One difference worth knowing: `device` is **device fidelity, not "a narrow window"**. A page that declares no `<meta name="viewport" content="width=device-width, initial-scale=1">` gets the default mobile viewport of **980 CSS pixels** and is zoomed out — exactly as a real phone would render it. To pin a layout width instead, pass `width`/`height` without `mobile`, which always takes effect.

Sidebar side (DSH Web UI):

- a **浏览器 / Browser** tab in the right sidebar holds the live view of *that* session's tab. It is **not** pinned to every session: it opens itself the moment the session gets a browser tab, so a conversation that never touches a browser shows no extra surface at all;
- the right sidebar's **guide page** carries an 内嵌浏览器 / Embedded browser entry, which is how you open the tab by hand (before the AI has started a browser, or after you closed it);
- the tab chip carries a small dot while the session it belongs to is waiting for a person — the only cross-session signal now that the host-wide overview is gone;
- the canvas accepts your mouse, wheel, keyboard and IME input — it is not a screenshot viewer, the events are replayed into the very CDP session the AI uses;
- the hand-over banner appears in the tab of **the session that asked**, with a 我已完成 / Done button that resumes the waiting tool call (and an optional note back to the AI);
- a toolbar with back / forward / reload / repaint, Tab / ⇧Tab / Enter to walk a form without aiming the mouse, and 结束并清理 / Close tab;
- closing the tab is obeyed: it does not come back by itself until the browser itself comes back — except for a *new* hand-over request, which would otherwise hang until it timed out.

## How it works

```mermaid
flowchart LR
  AI["AI turn<br/>(browser_embedded_* tools)"] -->|"CDP · this session's tab"| B["Chrome<br/>(persistent profile)"]
  H["You, in the DSH Web UI"] -->|"mouse · keyboard · IME"| P["Right-sidebar tab<br/>(client half)"]
  P -->|"WebSocket /api/dsh-embedded-browser/stream?session=…"| S["Host half<br/>(screencast + input replay)"]
  P -->|"GET /api/dsh-embedded-browser/sessions (5 s visible / 20 s hidden)"| S
  S -->|"Page.startScreencast (the visible tab)"| B
  S -->|"Page.captureScreenshot (~7 fps, the rest)"| B
  S -->|"Input.dispatch* (that tab)"| B
  B -->|"JPEG frames"| S --> P
  B -.->|"one profile: cookies, localStorage"| D[("profile dir<br/>$DSH_HOME/embedded-browser/profile")]
```

- The host half launches one Chrome per DSH host process. With `mode: auto` it runs **headed on a private Xvfb** when Xvfb is available (better fingerprint than headless) and falls back to `--headless=new` otherwise.
- A session's tab is created **lazily** — on that session's first `browser_embedded_*` call, or when the human presses the open button in that session's sidebar tab — and closed when the session is disposed, when the AI calls `browser_embedded_close`, or when the human presses 结束并清理 / Close tab. Sessions are isolated in *page state*, not in identity: they share the profile, so a login performed once is available everywhere.
- Every tab is **activated once** when it is created. A Chrome target that was never activated silently discards every injected input event for the rest of its life, and one activation repairs it permanently. Afterwards a session's tab accepts input even while it is in the background — selection is shared with the human within the conversation.
- Chrome only emits screencast frames for the **active tab**. The sidebar tab you are actually looking at sends `focus` and owns the real `Page.startScreencast`; other watched panels are served by polled `Page.captureScreenshot` frames (~7 fps target; its first frame can be cold — seconds — while another tab owns the screencast). A freshly opened panel always gets a seeded frame, because a static page emits none on its own.
- The tab body is **mounted while its tab is invisible** too (a collapsed column, an inactive tab), so the component gates on visibility rather than on mount: a hidden tab holds no WebSocket and asks for no `focus`, and therefore never steals the browser's foreground from whoever is watching.
- Tools carry no session parameter: every handler reads the session id from its own execution context (`exec.agent.id`), so tool names and parameters stay small and a session can never steer another session's tab. A call with no owning session is an error.
- Tools register immediately in this fork; the optional lazy gate remains available when explicitly configured.
- The panel is served by the host webserver, on the same origin and behind **the same session authentication as the Web UI itself** (`connection.requestRejection`). The routes that belong to a session carry its id — `GET /api/dsh-embedded-browser/state?session=…`, `POST /open|/close` (session in the body), and the `/stream?session=…` WebSocket upgrade — while `GET /sessions` and `GET /health` describe the whole host, and `POST /human-done` settles a request by id. No extra port, no extra token, no tunnel.
- Human take-over is per session: two sessions can wait on a human at the same time, and a request is delivered only to the sidebar tab of its own session.
- Frames travel as JPEG over one WebSocket; input travels back as small JSON messages. Frames are dropped rather than queued when your connection falls behind.
- Nothing is written into DSH core: the plugin is one composition row.
- The measured constraints behind these choices are written down in [`references/PITFALLS.md`](references/PITFALLS.md) (#11–#13 for the browser, #14–#16 for the sidebar and the lazy gate).

## Requirements

- DSH `>= 0.1.5-rc.2`, Node `>= 22.19`.
- A Chromium-family browser. Auto-detected in this order: `browserPath` config → `google-chrome-stable` / `google-chrome` / `chromium` / `chromium-browser` / `chrome` on `PATH` → Playwright cache (`~/.cache/ms-playwright/chromium-*/…`) → Puppeteer cache.
- Optional: `Xvfb` on `PATH` for headed mode. Without it the plugin runs headless automatically.

## Install

Version **0.3.0**. This release renames the package, so it breaks every name an 0.2.0 install used: `dsh-browser-panel` → `dsh-embedded-browser`, `browser_panel_*` → `browser_embedded_*`, `/api/dsh-browser-panel/*` → `/api/dsh-embedded-browser/*`, `$DSH_HOME/browser-panel/profile` → `$DSH_HOME/embedded-browser/profile`. 0.2.0 is the last release under the old name; 0.2.0's own break (per-session tabs, no shared-page mode) still stands.

```sh
# This fork (npm package still refers to upstream)
dsh plugin --profile web add github:thozoz/dsh-embedded-browser
```

A plugin has to end up in the profile **twice**: as a dependency (so its code is in the profile's own `node_modules`) and in `dsh.profile.bundles` (so the patch that inserts the plugin row is actually applied). `dsh plugin … add` does both, because the package declares `dsh.bundle`; a dependency added by hand alone mounts nothing.

The package ships its built JavaScript, so nothing is compiled on install.

Restart the Web UI afterwards (adding a plugin row is a boot-time composition change):

```sh
systemctl --user restart dsh-web      # or however you run `dsh web`
```

### Optional lazy tool gate

The bundle registers tools immediately. To opt into deferred schemas, set `lazyTools: true` and supply the `browser-use` skill separately; it does not ship in this package. Its name is `SKILL_NAME` in `lib/lazy.js`.

## Verify

1. Confirm `browser_embedded_tabs` is available. Only when using `lazyTools: true`, open the gate with the separately installed `browser-use` skill first.
2. Ask for a page:

   ```
   Use browser_embedded_navigate to open https://example.com, then browser_embedded_snapshot.
   ```

3. The first browser call opens a **浏览器 / Browser** tab in the right sidebar by itself — that is this session's own tab in the host Chrome. Before there is any browser there is no tab; the sidebar's guide page (内嵌浏览器 / Embedded browser) is the manual way to open one first.
4. Ask the AI to hand over, then complete the login yourself in that tab:

   ```
   Call browser_embedded_ask_human with the instruction "请在面板里完成登录，然后点我已完成".
   ```

5. Log in, press **我已完成** — the tool call returns, and the AI continues with an authenticated session. Close the tab first if you like: the next hand-over request brings it back.
6. In a second session, open its own browser tab: it is a *different* tab, but it is already logged in, because the profile is shared. Close one session's tab (`browser_embedded_close`, or 结束并清理 / Close tab) and reopen it: still logged in.

## Configuration

Override any field from your own patch layer (`~/.dsh/cordis.patch.yml`, or the profile's `cordis.patch.yml`). The whole `config` key is replaced, so restate what you need:

```yaml
- id: embedded-browser
  config:
    mode: headless            # auto | headed | headless
    viewport: 1280x800
    idleShutdownMinutes: 60
    lazyTools: false
```

| Key | Default | Meaning |
|---|---|---|
| `browserPath` | `''` | Explicit Chrome/Chromium path; empty = auto-detect. |
| `profileDir` | `''` | Persistent profile; empty = `$DSH_HOME/embedded-browser/profile`. Shared by every session. |
| `mode` | `auto` | `auto` = headed on a private Xvfb when available, else headless. |
| `screen` | `1440x900x24` | Geometry of the private Xvfb. |
| `windowSize` | `1440x900` | Chrome window size in headed mode. |
| `viewport` | `1440x900` | The **default** emulated viewport of every tab — `browser_embedded_emulate` overrides it per tab, and `reset` comes back here. |
| `xvfbDisplay` | `:99` | Preferred X display; the next free one is used if taken. |
| `port` | `0` | Fixed DevTools port; `0` picks a free one. |
| `startUrl` | `about:blank` | First URL of each session's fresh tab. |
| `extraArgs` | `[]` | Extra Chrome switches. |
| `snapshotMaxChars` | `4000` | Page text budget per snapshot. |
| `maxElements` | `80` | Interactive elements listed per snapshot. |
| `screencastQuality` | `60` | JPEG quality of the stream (and of the polled stills). |
| `screencastMaxWidth` | `1440` | Maximum streamed frame width. |
| `pollFrameMs` | `140` | Poll interval for panels that cannot own the foreground screencast (~7 fps). Values below `60` are clamped. |
| `askHumanTimeoutSeconds` | `600` | Default budget of `browser_embedded_ask_human`. |
| `idleShutdownMinutes` | `60` | Host-wide idle timeout. Watched panels, pending human actions and detected dirty forms defer shutdown; `0` disables it. Stopping loses tab/form state, not persistent logins. |
| `autoStart` | `false` | Start the browser with the host instead of on first use. |
| `lazyTools` | `true` in Config; **`false` in shipped bundle** | Optional host-wide skill gate; disabled by this fork’s bundle. |
| `startTimeoutMs` | `20000` | How long to wait for the DevTools endpoint after launch. |

## Security notes

- The panel and its WebSocket live behind the **same authentication as the DSH Web UI**. Anyone who can see the panel can already drive the host browser — treat Web UI access accordingly.
- Sessions are isolated in page state, **not** in identity: every session uses the same browser profile, and therefore the same cookies and logins. That is the point of the plugin, but it also means one session's AI can reach any site the profile is logged into.
- The browser profile holds real sessions. It stays on the host, under the DSH home, is never uploaded, and is not part of the Git repository.
- Browser traffic goes out from the container. A data-centre IP is a weaker signal than your laptop's; for sites that are aggressive about automation, `mode: headed` (the default whenever Xvfb is available) is the better half of the trade.
- Prefer running Chrome as a non-root user with the sandbox on; the plugin only adds `--no-sandbox` automatically when the host process runs as root.

## Rollback

```sh
dsh plugin --profile web remove dsh-embedded-browser   # or delete the row from cordis.patch.yml
```

Then restart the Web UI. The profile directory is left in place, so reinstalling keeps your logins. Delete `$DSH_HOME/embedded-browser/profile` to forget them.

## Multiple tabs and idle protection

The panel has a title tab strip, **+**, individual **×**, and an editable address field (Enter to navigate). Ctrl/Cmd+L/T/W work while the panel is focused, unless intercepted by the outer browser. Right-click on an HTML link opens it directly in a new tab, not a native context menu; Ctrl/Cmd-click and middle-click are supported for ordinary links.

```js
browser_embedded_navigate({ url: "https://example.com", newTab: true })
browser_embedded_tabs({ action: "list" })
browser_embedded_tabs({ action: "select", tabId: "<id from list>" })
browser_embedded_snapshot({ tabId: "<id from list>" })
browser_embedded_tabs({ action: "list", keepAliveMinutes: 0 }) // disable automatic reaping
browser_embedded_tabs({ action: "list", keepAliveMinutes: 60 }) // restore one-hour timeout
```

Optional `tabId` selects the tab for both AI and human. Known-opener popups are adopted and selected. Closing the last tab leaves an empty panel. `keepAliveMinutes` changes the **whole host browser’s in-process timeout**, not a single tab or conversation. Dirty-form detection is heuristic and cannot guarantee every iframe/custom editor; use `0` for critical unsaved work. Process restart loses open pages and overrides, while cookies persist.

## Diagnostics and tests

Rotating JSONL logs live under `$DSH_HOME/embedded-browser/logs/diagnostics.jsonl`; no page content, typed text or cookie values are intentionally recorded. `ImageBitmap.close()` releases each decoded frame, same-size canvas resets are avoided, and hidden documents skip decoding.

Run `npm test` for regressions or `npm run test:full` for additional stress and real one-minute idle cycles. These are not a nine-hour soak or a measured one-hour shutdown test. See [agent guide](AGENTS.md), [setup notes](LOCAL-SETUP.md) and [memory audit](MEMORY-AUDIT.md) for evidence and limitations.

## License

MIT
