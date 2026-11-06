# Harness browser-panel graphics lifetime audit — 2026-11-07

## Proven defects

- The original `lib/client.js` paint callback created an ImageBitmap for every JPEG, assigned it into an otherwise unused ref and never called close(). drawImage copies pixels and does not consume that bitmap. Both canvas dimensions were reset on every frame even if unchanged. Fix: finally-close every decoded bitmap (including failure/unmount/hidden paths), remove unused ref, resize only if changed.
- The original hidden-document handler sent blur but left the socket connected. `lib/screencast.js` selected every non-front connection for screenshot polling even if watching=false. Fix: only watching connections get pollers; hidden documents also skip image decoding client-side.
- Existing cached viewport could remain stale after emulation if the renderer read timed out; update its cache when applying emulation (small regression fix exposed by smoke tests).

## Live evidence and limitations

Instrumented the authenticated live Harness GUI in existing Chromium, counting createImageBitmap, close and canvas dimension setters. No page text, cookies or passwords captured. Samples every 10 seconds; process RSS from Linux ps. User's Firefox/Windows GPU/shared-memory counters are not accessible from this host.

The first 180s capture contains a client HMR update during capture: first 130s use original code (870 created, 0 closed); remaining 50s include fixed code (212 newly created, 212 closed). Thus it is a mixed rollout trace, NOT a perfectly isolated full 180s old-code benchmark. First 10s: 184 frames, 953,856,000 RGBA bytes, 368 canvas resets, 0 closes. At 1440x900 this is 5,184,000 bytes/frame, ~18.4fps and ~95.4 MB/s allocation traffic. Across mixed capture average decoded allocation 32.2 MB/s. Allocation traffic is NOT a direct measurement of retained GPU memory. Chromium GC may free unclosed bitmaps later; this is a deterministic missing-release bug but not proof it solely explains user's Firefox 2GB/min.

Independent 180s AFTER capture: 377 bitmaps created, 377 closed, 0 redundant canvas resets. JS heap 74.1→68.6 MiB; observed GUI renderer PID 396997 RSS 568.4→391.8 MiB (range 361.4–631.0); GPU PID 385073 RSS 203.1→186.1 MiB. Other work/streaming and visibility changes affect these RSS figures; no isolated Firefox working-set equivalence is claimed. Existing unclosed frames from before rollout can still remain until page reload.

Hidden GUI test: activate a temporary blank tab, allow 2s settling, sample 10s later: created count unchanged (2127→2127), hidden=true. Restore GUI activation and close temporary blank target.

Regression test failed before fix (0 closes for 100 frames) and passed after fix: all 100 closed, no same-size backing resets, draw exception closes, asynchronous unmount closes, hidden page avoids decode. Full 22 lazy-gate and 67 Chromium smoke tests plus diagnostics/tabs passed (including hidden-panel poller removal). Smoke fixture now explicitly focuses both visible panels; an unfocused/hidden connection no longer means a visible panel.

## Other reviewed sources

Official ui-layout client drag/ResizeObserver rAF callbacks are bounded and disposed (lib/client.js lines 153–165, 218–235); no continuous canvas/frame allocation there. Better Sidebar frame sync inspected: degraded transform-only rAF path, canceled at unmount; no bitmap decode. dsh-team source map renderer/WorldScene has visibility/intersection gates and geometry/material/texture/renderer disposal and context loss on unmount; no active WebGL canvas was present in tested GUI. These are not a blanket guarantee against unrelated leaks.

`/home/harness/btk-speed-daemon.js` reviewed: touches only btkakademi.gov.tr page and cinema8.com iframe on host CDP; once-per-document interval guard prevents repeated 400ms interval installation. It has no createImageBitmap/canvas allocation. Video autoplay/rate forcing can keep server browser/video and consequently sidebar stream active, amplifying the panel bug. Unbounded WS wait on the main page is a separate possible host-side resource issue, not evidence of the Windows Firefox graphics leak. Not modified or stopped.

## Deployment

The client change was observed live via the existing client HMR (close counts started increasing). Refresh the user's Firefox GUI to discard already accumulated old graphical resources. Server screenshot-poller guard requires reloading the Host plugin to replace its cached module; do not interrupt unrelated ongoing browser sessions without coordination. No Harness core/global npm/BTK script edits.
