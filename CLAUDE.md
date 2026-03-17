# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A browser-based app that uses the webcam and MediaPipe Pose Landmarker to detect when the user's hand gets near their head (hair), then plays an alert sound and shows a warning. Deployed on Vercel at https://hair-guard.vercel.app/.

## Development

```bash
./serve.sh        # starts python3 HTTP server on :8000 and opens browser
```

No build step, no bundler, no package manager. All dependencies are loaded via CDN ES module imports. Just serve the files over HTTP (needed for ES modules and webcam access).

## Architecture

Single-page app with three files:

- **app.js** — all logic: shows a start screen on first visit (auto-starts if camera was previously granted via Permissions API), initializes MediaPipe pose model (GPU-delegated, VIDEO mode), captures webcam, runs detection loop via `requestAnimationFrame`, draws landmarks on canvas overlay, triggers audio alert when wrist-to-temple distance drops below `DISTANCE_THRESHOLD`. Handles camera permission denial with an error message.
- **index.html** — start screen with button/explanation, video element, canvas overlay, warning banner
- **style.css** — fullscreen dark layout, video is mirrored via `scaleX(-1)` (canvas too)

Key constants in app.js: `COOLDOWN_SECONDS`, `WAIT_BEFORE_BEEP_SECONDS`, `DISTANCE_THRESHOLD`. The detection uses MediaPipe landmarks 7/8 (temples/ears) and 15/16 (wrists).
