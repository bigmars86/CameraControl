# CameraControl

[![Build](https://img.shields.io/github/actions/workflow/status/bigmars86/CameraControl/build.yml?branch=main&label=build&logo=github)](https://github.com/bigmars86/CameraControl/actions/workflows/build.yml)
[![Code quality](https://img.shields.io/github/actions/workflow/status/bigmars86/CameraControl/quality.yml?branch=main&label=code%20quality&logo=github)](https://github.com/bigmars86/CameraControl/actions/workflows/quality.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/bigmars86/CameraControl/codeql.yml?branch=main&label=CodeQL&logo=github)](https://github.com/bigmars86/CameraControl/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/bigmars86/CameraControl?sort=semver)](https://github.com/bigmars86/CameraControl/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/bigmars86/CameraControl/total)](https://github.com/bigmars86/CameraControl/releases)
[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/license-CC%20BY--NC--SA%204.0-lightgrey)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D6)
![PowerShell 5.1+](https://img.shields.io/badge/PowerShell-5.1%2B-5391FE?logo=powershell&logoColor=white)
[![pre-commit](https://img.shields.io/badge/pre--commit-enabled-brightgreen?logo=pre-commit)](https://github.com/pre-commit/pre-commit)
[![Code style: Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier)](https://prettier.io)
[![Protected by gitleaks](https://img.shields.io/badge/protected%20by-gitleaks-blue)](https://github.com/gitleaks/gitleaks)

Browser-based control panel for PTZ IP cameras with the `ptzctrl.cgi` interface (Xiongmai/XMEye firmware and compatible clones): live preview, pan/tilt/zoom and preset positions with thumbnails. It ships as a single Windows EXE that starts a small local proxy and opens the UI in Chrome's app mode.

## Features

- Live preview with low delay (H.264 over WebSocket; the preview keeps up with the live picture)
- Pan, tilt and zoom by mouse, touch or numpad, with adjustable speeds
- Presets with your own thumbnails and hotkeys; save the current position with one click
- Copes with a camera that is switched off: controls are disabled and it reconnects automatically
- Settings and log next to the EXE; the camera password is stored encrypted (Windows DPAPI)
- English, German and Greek UI, dark and light theme

## Quick start

1. Download `CameraControl.exe` from the [latest release](https://github.com/bigmars86/CameraControl/releases/latest).
2. Put it into a folder you can write to (e.g. `Documents\CameraControl`, not `Program Files`): settings and log are stored next to it.
3. Optional: put preset images into `imgs\presets\` next to the EXE (see [Preset System](#preset-system)).
4. Start it, click ⚙️ and enter the camera's IP address, user name and password.

Requires Windows 10/11 and Google Chrome (otherwise the default browser is used).

> The EXE is not code-signed, so Windows SmartScreen may warn on the first start. Every release lists the SHA-256 checksum and has a [build provenance attestation](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations) showing that it was built by GitHub Actions from this repository: `gh attestation verify CameraControl.exe --repo bigmars86/CameraControl`

## Settings

Everything you change in the app is saved to `camera_config.json` next to the EXE:

| Key                                  | Default          | Meaning                                                  |
| ------------------------------------ | ---------------- | -------------------------------------------------------- |
| `ip`                                 | `192.168.178.19` | Camera address (`host` or `host:port`)                   |
| `username`                           | `admin`          | Camera user                                              |
| `passwordProtected`                  |                  | Camera password, encrypted with Windows DPAPI            |
| `timeout`                            | `5`              | Seconds to wait for an answer from the camera            |
| `retryInterval`                      | `10`             | Seconds between connection checks                        |
| `maxDelay`                           | `1`              | Maximum preview delay in seconds before it jumps to live |
| `panSpeed`, `tiltSpeed`, `zoomSpeed` | `5`              | PTZ speeds (1-10)                                        |
| `language`                           | `en`             | `en`, `de` or `el`                                       |
| `theme`                              | `dark`           | `dark` or `light`                                        |

To prepare a PC you can write `"password": "..."` into the file by hand; at the next start CameraControl replaces it with the encrypted `passwordProtected`. The encrypted value only works for the same Windows user on the same PC; anywhere else, enter the password again in the settings.

## Security

- The camera password is never sent to the browser and is stored encrypted.
- The proxy listens on `localhost` only and answers API calls only from its own page, so other websites cannot control the camera or read the settings.
- `camera_config.json`, logs and preset images are excluded from git; pre-commit and CI scan for secrets with gitleaks.
- Please report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the setup (pre-commit, linting) and the release process. The technical details follow below.

## License

CameraControl is licensed under [CC BY-NC-SA 4.0](LICENSE): you may use, share and adapt it for **non-commercial** purposes with attribution, and adaptations you share must use the same license. Bundled third-party code keeps its own license, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

## Architecture Overview

```
Browser  ──────────────────────────────────────────────────────────────
  │  HTTP GET/POST  http://localhost:8080/...
  ▼
proxy-server.ps1  (PowerShell HttpListener on port 8080)
  │  Digest/Basic auth  http://192.168.178.19/...
  ▼
IP Camera (Xiongmai firmware, thttpd/2.29)

Browser ──────────────────── WebSocket ws://192.168.178.19:4567/ws/ ──▶ Camera
  (video stream — direct, not through proxy)
```

The proxy serves all static files from the `Cam/` directory and translates clean REST API calls into the camera's proprietary CGI endpoints. The video stream bypasses the proxy entirely — the browser connects directly to the camera's WebSocket port (4567) using the Streamedian RTSP-over-WebSocket player.

---

## Project Structure

```
Cam/
├── index.html              # Main UI
├── proxy-server.ps1        # PowerShell proxy + API server
├── build.ps1               # Build script (produces CameraControl.exe)
├── camera.ico              # Application icon
├── camera_config.json      # Settings, created by the app (not in git)
├── css/
│   ├── main.css            # CSS entry point (@import)
│   ├── base.css            # Variables, reset
│   ├── layout.css          # Grid layout, video container
│   ├── controls.css        # PTZ button styles
│   ├── modal.css           # Config modal
│   ├── presets.css         # Preset grid and save button
│   └── responsive.css      # Mobile breakpoints
├── js/
│   ├── websocket.js        # Streamedian RTSP-over-WebSocket player (vendored, patched)
│   ├── settings.js         # Settings loaded from / saved by the proxy
│   ├── language.js         # i18n manager
│   ├── camera.js           # Camera controller (stream, PTZ, presets)
│   ├── presets.js          # Preset discovery and UI
│   ├── ui.js               # Button/keyboard event handling
│   └── app.js              # Application bootstrap
├── lang/
│   ├── en.json             # English translations
│   ├── de.json             # German translations
│   └── el.json             # Greek translations
└── imgs/
    ├── icons/              # Favicons (favicon-16.png, favicon-32.png, favicon-96.png)
    ├── presets/            # Preset thumbnail images (see Preset Filenames below, not in git)
    └── placeholder.jpg     # Fallback image
```

---

## How to Start

There are two ways to run the app: as a compiled standalone EXE (recommended for daily use) or directly from source using PowerShell (useful for development).

---

### Option A: Standalone EXE (recommended)

#### 1. Build the EXE

**Requirements:** ps2exe module — install once:

```powershell
Install-Module ps2exe -Scope CurrentUser
```

Then build:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\path\to\Cam\build.ps1"
```

This produces `CameraControl.exe`. The build script embeds all web assets (HTML, CSS, JS, translations, favicons, images) directly into the binary — no source files are needed alongside it. Pass `-Version 1.2.3` to stamp a version into the EXE and the log.

#### 2. Settings

Nothing to prepare: on the first save, the app creates `camera_config.json` next to the EXE (see [Settings](#settings)).

#### 3. Add preset images (optional)

Place preset thumbnail images in an `imgs\presets\` folder next to the EXE. They are copied into the temp directory at startup.

#### 4. Run

Double-click `CameraControl.exe`. It will:

1. Extract assets to `%TEMP%\CameraControl\`
2. Start the proxy on port 8080
3. Open Chrome in app mode (no address bar)
4. Clean up and exit when Chrome is closed

> **Note:** Only one instance can run at a time. Starting the EXE a second time shows a message ("Camera Control is already running", in the Windows display language if available) and exits without touching the running instance.

The log is written to `CameraControl.log` next to the EXE (over 1 MB, it is renamed to `CameraControl.old.log` at the next start). If the EXE folder is not writable, the log goes to `%TEMP%\CameraControl\server.log`; logging problems never show error dialogs.

---

### Option B: Run from source (development)

#### Prerequisites

- Windows with PowerShell 5.1+
- A modern browser (Chrome/Edge recommended)

#### 1. Settings

In source mode, `camera_config.json` lives next to `proxy-server.ps1` (it is excluded from git). Without the file, the defaults from [Settings](#settings) are used.

#### 2. Start the proxy server

```powershell
# Standard — manual browser open, Ctrl+C to stop
powershell -ExecutionPolicy Bypass -File "proxy-server.ps1"

# With -Launch — opens Chrome automatically, stops when Chrome closes
powershell -ExecutionPolicy Bypass -File "proxy-server.ps1" -Launch
```

Startup output:

```
[config] Loaded C:\...\Cam\camera_config.json

========================================================
  Camera Proxy Server dev
========================================================
  Camera : 192.168.178.19
  Config : C:\...\Cam\camera_config.json
  URL    : http://localhost:8080/
  Press Ctrl+C to stop
========================================================

[camera] Connected (192.168.178.19)
```

The camera is checked in the background, so the server starts immediately even when the camera is off (`[camera] Offline (...) - retrying every 10s`).

#### 3. Open the browser

Navigate to: **http://localhost:8080/**

Stop the server at any time with `Ctrl+C`.

---

## How the App Works

### Startup sequence

1. `index.html` loads `api/settings.js` (the saved settings, without the password) before anything else, so the theme is right from the first paint
2. `app.js` initialises `Settings`, `LanguageManager`, `Camera`, `PresetManager`, and `UIController`
3. Language is loaded from `lang/{code}.json` (saved language or English default)
4. Presets are loaded by fetching the `imgs/presets/` directory listing from the proxy
5. `camera.js` polls `/api/health` (the proxy checks the camera in the background); once the camera is reachable, the controls are enabled and `startStream()` launches the Streamedian WebSocket player pointing at `ws://{camera}:4567/ws/`

### Camera offline

While the camera is not reachable (e.g. no power), the preview shows "Camera not reachable", and PTZ buttons, zoom, presets (call and save) and the keyboard shortcuts are disabled. The proxy retries the camera every _Retry connection every (s)_ seconds (default 10, settings dialog) and keeps checking it while connected, so a camera that loses power is detected as well. As soon as it answers again, controls and preview come back automatically.

### Video streaming

The camera does **not** provide MJPEG or HTTP snapshots. It streams H.264 video via a proprietary RTSP-over-WebSocket protocol (WSP/1.1) on port 4567.

`js/websocket.js` is the [Streamedian](https://github.com/Streamedian/html5_rtsp_player) player, copied from the camera's own web UI and patched to:

- Skip the AAC audio track (camera audio codec is unsupported by Chrome's MSE)
- Treat unsupported codec tracks as non-fatal (skip rather than throw)
- Hand video to the decoder every 100 ms instead of 200 ms
- Use the live edge (last buffered range) when seeking
- Not reconnect or keep timers running after the player was destroyed

Initialization in `camera.js`:

```javascript
this._player = Streamedian.player('cameraStream', {
  socket: `ws://${this.cameraIP}:4567/ws/`,
  redirectNativeMediaErrors: true,
  bufferDuration: 10,
});
```

The `<video>` element's `src` is set to `rtsp://127.0.0.1/1` — this is a dummy URI the Streamedian library reads internally; the actual data comes from the WebSocket.

`bufferDuration` only limits how much already played video is kept in memory; it does not affect the delay.

**Preview delay.** A `<video>` element fed by Media Source Extensions never catches up on its own: every network or CPU hiccup used to add delay permanently. `keepLive()` in `camera.js` therefore watches the distance to the live edge every 250 ms:

- more than 0.5 s behind: play at 1.2× until it is back at 0.3 s
- more than _Max. preview delay (s)_ behind (default 1 s, settings dialog): jump to the live edge
- no new video for 10 s (or the retry interval, if longer): restart the stream

The camera's encoder itself adds a few hundred milliseconds, so the IP preview cannot be quite as instant as the camera's USB feed in Zoom.

### PTZ controls

Hold a directional button (or numpad key) → camera moves. Release → stop command sent.

**Button → proxy → camera mapping:**

| UI Action       | Proxy POST body                                | Camera CGI                       |
| --------------- | ---------------------------------------------- | -------------------------------- |
| ↖ ↑ ↗ ← → ↙ ↓ ↘ | `{"code":"LeftUp"/"Up"/…, "arg1":5, "arg2":5}` | `ptzctrl.cgi?ptzcmd&leftup&5&5`  |
| ● (stop)        | `{"action":"stop"}`                            | `ptzctrl.cgi?ptzcmd&ptzstop&0&0` |
| 🔍+ / 🔍-       | `{"code":"ZoomTele"/"ZoomWide", "arg1":5}`     | `ptzctrl.cgi?ptzcmd&zoomin&5&5`  |

Pan, tilt, and zoom speeds (1–10) are configurable in the ⚙️ settings panel and saved in `camera_config.json`.

### Keyboard controls

| Key                    | Action                         |
| ---------------------- | ------------------------------ |
| Numpad 7/8/9/4/6/1/2/3 | Pan/tilt (phone-keypad layout) |
| Numpad 5               | Stop                           |
| Numpad + / −           | Zoom in / out                  |
| Arrow keys             | Pan/tilt                       |
| Page Up / Page Down    | Zoom in / out                  |
| Space                  | Stop                           |
| 0–9 (top row)          | Call preset by key binding     |

Keys trigger the same move/stop cycle as mouse buttons. Releasing a numpad key always sends a stop. Losing window focus also sends stop.

### Configuration modal

Click ⚙️ to open. Changes take effect immediately and are saved in `camera_config.json` next to the EXE. The camera reconnects only when its address, user name or password changed. The password field stays empty: type a new password to change it, leave it empty to keep the current one.

_Connection_ settings:

- **Retry connection every (s)** — how often the proxy checks the camera (2–3600, default 10)
- **Max. preview delay (s)** — how far the preview may fall behind before it jumps to live (0.5–10, default 1)

---

## Preset System

### What a preset is

A preset is a saved pan/tilt/zoom position stored in the camera's firmware. The camera supports at least slots 1–255. Clicking a preset image commands the camera to move to that saved position.

### Preset thumbnail filenames

Place image files in the `imgs/presets/` folder. The filename encodes which preset slot to call:

| Filename format    | Example   | Key binding | Preset slot called |
| ------------------ | --------- | ----------- | ------------------ |
| `{slot}.jpg`       | `5.jpg`   | none        | 5                  |
| `{key}-{slot}.jpg` | `1-5.jpg` | key `1`     | 5                  |
| `{key}-{slot}.png` | `a-3.png` | key `a`     | 3                  |

- **`{slot}`** — the camera preset number (integer)
- **`{key}`** — a single character (`0–9` or `a–z`) that triggers this preset from the keyboard

Supported image formats: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`

**Examples:**

```
imgs/presets/
├── 1-1.jpg     # Key "1" → go to camera preset slot 1
├── 2-2.jpg     # Key "2" → go to camera preset slot 2
├── a-10.jpg    # Key "a" → go to camera preset slot 10
└── 5.jpg       # No key binding → go to camera preset slot 5
```

The preset grid is sorted by key (alphabetically), then by slot number.

### Saving a preset position

Point the camera where you want using the PTZ controls, then hover over a preset image and click the 💾 button that appears. This overwrites that camera slot with the current position.

The save button shows ⏳ while writing, then ✅ on success or ❌ on failure, before returning to 💾.

---

## Proxy Server API Reference

All endpoints are on `http://localhost:8080/`. Requests to `/api/*` from other websites are rejected with `403` (checked via the `Sec-Fetch-Site` and `Origin` headers); local tools like `Invoke-WebRequest` send neither and are allowed.

### `GET /api/health`

Returns the camera state as last checked by the proxy (no camera request is made). `pending` is `true` until the first check after startup or a config change has finished.

```json
{ "connected": true, "pending": false }
```

### `GET /api/settings.js`

The saved settings as a script (`window.CAMERA_SETTINGS = {...};`), loaded by `index.html`. Never contains the password.

### `POST /api/settings`

Changes and saves any of the [settings](#settings). `password` sets a new camera password (empty = keep). Values are validated and clamped.

**Request body (example):**

```json
{ "ip": "192.168.178.19", "username": "admin", "password": "new-password", "retryInterval": 10 }
```

**Response:** `reconnect` tells whether the camera connection was re-initialised, `saved` whether the file could be written.

```json
{ "status": "ok", "reconnect": true, "saved": true, "file": "C:\\...\\camera_config.json" }
```

### `POST /api/ptz`

Send a PTZ movement or stop command. Like the preset endpoints, it answers `503` with `{"status":"error","message":"Camera not connected"}` while the camera is not reachable.

**Request body (move):**

```json
{ "code": "Up", "arg1": 5, "arg2": 5 }
```

**Request body (stop):**

```json
{ "action": "stop" }
```

Valid `code` values: `Up`, `Down`, `Left`, `Right`, `LeftUp`, `RightUp`, `LeftDown`, `RightDown`, `ZoomTele`, `ZoomWide`

**Response:**

```json
{ "status": "ok", "navigate": "up" }
```

### `POST /api/preset/{n}`

Move the camera to preset slot `n`.

```
POST /api/preset/3
```

**Response:**

```json
{ "status": "ok", "preset": 3 }
```

### `POST /api/preset/{n}/save`

Save the camera's **current position** into preset slot `n` (overwrites the slot).

```
POST /api/preset/3/save
```

**Response:**

```json
{ "status": "ok", "preset": 3 }
```

### `GET /imgs/presets/`

Returns an HTML directory listing of files in the `imgs/presets/` folder. Used by the frontend to discover preset images.

### Static files

All other `GET` requests are served as static files from the `Cam/` directory (HTML, CSS, JS, images, language JSON).

---

## Camera CGI API

The camera (`thttpd/2.29`, Xiongmai/XMEye firmware) exposes a minimal HTTP CGI interface. Authentication is Digest (falls back to Basic).

### PTZ control

```
GET /cgi-bin/ptzctrl.cgi?ptzcmd&{command}&{param1}&{param2}
```

All commands return `HTTP 200` with an **empty body**.

| Command     | Params                 | Description         |
| ----------- | ---------------------- | ------------------- |
| `up`        | pan_speed, tilt_speed  | Tilt up             |
| `down`      | pan_speed, tilt_speed  | Tilt down           |
| `left`      | pan_speed, tilt_speed  | Pan left            |
| `right`     | pan_speed, tilt_speed  | Pan right           |
| `leftup`    | pan_speed, tilt_speed  | Pan-tilt diagonal   |
| `rightup`   | pan_speed, tilt_speed  | Pan-tilt diagonal   |
| `leftdown`  | pan_speed, tilt_speed  | Pan-tilt diagonal   |
| `rightdown` | pan_speed, tilt_speed  | Pan-tilt diagonal   |
| `zoomin`    | zoom_speed, zoom_speed | Zoom in (telephoto) |
| `zoomout`   | zoom_speed, zoom_speed | Zoom out (wide)     |
| `ptzstop`   | 0, 0                   | Stop all movement   |

Speed range: 1–10 (0 = stop only).

### Preset management

```
GET /cgi-bin/ptzctrl.cgi?ptzcmd&poscall&{n}    # Go to preset slot n
GET /cgi-bin/ptzctrl.cgi?ptzcmd&posset&{n}     # Save current position to slot n
```

Both return `HTTP 200` with an empty body.

### Video stream

```
WebSocket  ws://{camera_ip}:4567/ws/
Subprotocols: control, data
Protocol: WSP/1.1 (proprietary RTSP tunnel)
Codec: H.264 video + AAC audio
```

The WebSocket server tunnels RTSP internally to the camera's RTSP daemon (`rtsp://127.0.0.1/1`). Use the Streamedian player (`js/websocket.js`) to decode — plain WebSocket or RTSP clients will not work directly.

---

## Camera Limitations

| Feature                   | Status           | Notes                                                                                                                                       |
| ------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Live video                | ✅ Works         | WebSocket H.264 via Streamedian                                                                                                             |
| Pan / Tilt / Zoom         | ✅ Works         | All 8 directions + zoom                                                                                                                     |
| Recall preset             | ✅ Works         | Slots 1–255                                                                                                                                 |
| Save preset               | ✅ Works         | Overwrites camera slot                                                                                                                      |
| **Read current position** | ❌ Not supported | Camera returns empty body for all position queries (`getpos`, `get_ptz_status`, `absmove`, etc.) — the firmware does not report coordinates |
| **ONVIF**                 | ❌ Not supported | SOAP endpoint returns null/unreachable                                                                                                      |
| Absolute move             | ❌ Not supported | No `absmove` API                                                                                                                            |
| Audio                     | ❌ Disabled      | Camera's AAC codec is not supported by Chrome's MSE; audio track is skipped                                                                 |
| MJPEG / snapshots         | ❌ Not available | `/action_snapshot` returns 0 bytes                                                                                                          |

Because position readback is unavailable, **presets are the only reliable way to return to a saved position**. The camera stores preset positions persistently in firmware across power cycles.

---

## Testing

> These commands test the proxy server running on port 8080 — either started via `proxy-server.ps1` or via `CameraControl.exe`. Only one can run at a time.

### Check proxy health

```powershell
Invoke-WebRequest -Uri "http://localhost:8080/api/health" -UseBasicParsing | Select-Object -ExpandProperty Content
# Expected: {"connected":true,"pending":false}
```

### Test PTZ command

```powershell
# Move up for ~0.5s then stop
Invoke-WebRequest -Uri "http://localhost:8080/api/ptz" -Method POST -Body '{"code":"Up","arg1":3,"arg2":3}' -ContentType "application/json" -UseBasicParsing
Start-Sleep -Milliseconds 500
Invoke-WebRequest -Uri "http://localhost:8080/api/ptz" -Method POST -Body '{"action":"stop"}' -ContentType "application/json" -UseBasicParsing
```

### Test preset recall

```powershell
Invoke-WebRequest -Uri "http://localhost:8080/api/preset/1" -Method POST -UseBasicParsing | Select-Object -ExpandProperty Content
# Expected: {"status":"ok","preset":1}  — camera moves to slot 1
```

### Test preset save

```powershell
# First move the camera to the desired position, then:
Invoke-WebRequest -Uri "http://localhost:8080/api/preset/1/save" -Method POST -UseBasicParsing | Select-Object -ExpandProperty Content
# Expected: {"status":"ok","preset":1}
```

### Test direct camera connectivity

```powershell
$cred = [System.Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes("admin:admin"))
$headers = @{ Authorization = "Basic $cred" }
Invoke-WebRequest -Uri "http://192.168.178.19/cgi-bin/ptzctrl.cgi?ptzcmd&poscall&1" -Headers $headers -UseBasicParsing
# Expected: StatusCode 200, empty body
```

### Check WebSocket port

```powershell
Test-NetConnection -ComputerName 192.168.178.19 -Port 4567
# TcpTestSucceeded : True
```
