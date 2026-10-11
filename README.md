# CameraControl

[![Build](https://img.shields.io/github/actions/workflow/status/bigmars86/CameraControl/build.yml?branch=main&label=build&logo=github)](https://github.com/bigmars86/CameraControl/actions/workflows/build.yml)
[![Code quality](https://img.shields.io/github/actions/workflow/status/bigmars86/CameraControl/quality.yml?branch=main&label=code%20quality&logo=github)](https://github.com/bigmars86/CameraControl/actions/workflows/quality.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/bigmars86/CameraControl/codeql.yml?branch=main&label=CodeQL&logo=github)](https://github.com/bigmars86/CameraControl/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/bigmars86/CameraControl?sort=semver)](https://github.com/bigmars86/CameraControl/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/bigmars86/CameraControl/total)](https://github.com/bigmars86/CameraControl/releases)
[![License: GPL-3.0](https://img.shields.io/github/license/bigmars86/CameraControl)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D6)
![PowerShell 5.1+](https://img.shields.io/badge/PowerShell-5.1%2B-5391FE?logo=powershell&logoColor=white)
[![pre-commit](https://img.shields.io/badge/pre--commit-enabled-brightgreen?logo=pre-commit)](https://github.com/pre-commit/pre-commit)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-fe5196?logo=conventionalcommits&logoColor=white)](https://www.conventionalcommits.org)
[![Code style: Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier)](https://prettier.io)
[![Protected by gitleaks](https://img.shields.io/badge/protected%20by-gitleaks-blue)](https://github.com/gitleaks/gitleaks)

Browser-based control panel for PTZ IP cameras with Xiongmai/XMEye firmware and compatible models: live preview, pan/tilt/zoom and preset positions with pictures. CameraControl is a single Windows program: it starts a small local web server and shows the control panel in an app window of Chrome or Edge.

## Features

- Live preview with low delay (H.264 over WebSocket); the preview keeps up with the live picture
- Pan, tilt and zoom with mouse, touch or keyboard, with adjustable speeds
- Presets with pictures and hotkeys: add them from the live preview with one click, call them with a click or a key
- Copes with a camera that is switched off: controls are disabled and it reconnects automatically
- The camera password is stored encrypted (Windows DPAPI) and never sent to the browser
- English, German and Greek, dark and light theme

## Requirements

- Windows 10 or 11
- Google Chrome or Microsoft Edge (the control panel opens as an app window of the browser chosen in the settings; without them the default browser is used)
- A PTZ IP camera with Xiongmai/XMEye firmware: HTTP control via `ptzctrl.cgi` and live video on port 4567

## Installation

1. Download `CameraControl.exe` from the [latest release](https://github.com/bigmars86/CameraControl/releases/latest).
2. Save it in any folder, for example `Documents\CameraControl`, and start it. Nothing is installed.
3. At the first start the settings open: enter the address, user name and password of the camera.

Only one instance runs at a time. Closing the window ends the program.

> Windows SmartScreen may warn on the first start of a new release, especially while it is not code-signed yet (see [Code signing policy](#code-signing-policy)). Every release lists its SHA-256 checksum and has a [build provenance attestation](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations) showing that it was built by GitHub Actions from this repository: `gh attestation verify CameraControl.exe --repo bigmars86/CameraControl`

## Usage

### Moving the camera

Hold an arrow button to move the camera, release it to stop. The speeds for pan, tilt and zoom are in the settings (gear icon).

| Key                                 | Action                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------- |
| Numpad 1-9                          | Pan and tilt like on a phone keypad, 5 stops                                |
| Arrow keys                          | Pan and tilt                                                                |
| Numpad + and -, Page Up / Page Down | Zoom in / out                                                               |
| Space                               | Stop                                                                        |
| 0-9, a-z                            | Call the preset with this hotkey (0-9 without a hotkey: preset 1-9, 0 = 10) |

### Presets

A preset is a camera position stored in the camera (numbers 1-255) together with a picture shown in CameraControl.

- **Add:** point the camera, click **+** in the preset list and choose a number and, optionally, a hotkey. The picture is taken from the live preview unless you choose an image file, and the current camera position is stored in the preset.
- **Call:** click the picture or press its hotkey.
- **Store a new position:** hover over the picture and click the disk icon.
- **Remove:** hover over the picture and click the trash icon. The position stays stored in the camera.

The pictures are files in `%LOCALAPPDATA%\CameraControl\presets` (_Open folder_ in the settings). You can also copy pictures there: `5.jpg` is preset 5, `1-5.jpg` is preset 5 with hotkey `1` (JPEG, PNG, GIF or WebP, at most 5 MB). Presets with a hotkey are listed first.

## Settings

Settings, preset pictures and the log are kept in `%LOCALAPPDATA%\CameraControl`, so they stay when you update or move the program:

| File                 | Content                                                         |
| -------------------- | --------------------------------------------------------------- |
| `camera_config.json` | Settings (see below)                                            |
| `presets\`           | Preset pictures                                                 |
| `CameraControl.log`  | Log of the last runs (moved to `CameraControl.old.log` at 1 MB) |

Everything you change in the app is saved to `camera_config.json`:

| Key                                  | Default  | Meaning                                                                                      |
| ------------------------------------ | -------- | -------------------------------------------------------------------------------------------- |
| `ip`                                 |          | Camera address (`host` or `host:port`)                                                       |
| `username`                           | `admin`  | Camera user                                                                                  |
| `passwordProtected`                  |          | Camera password, encrypted with Windows DPAPI                                                |
| `timeout`                            | `5`      | Seconds to wait for an answer from the camera                                                |
| `retryInterval`                      | `10`     | Seconds between connection checks                                                            |
| `maxDelay`                           | `1`      | Maximum preview delay in seconds before it jumps to live                                     |
| `panSpeed`, `tiltSpeed`, `zoomSpeed` | `5`      | PTZ speeds (1-10)                                                                            |
| `language`                           | `en`     | `en`, `de` or `el`                                                                           |
| `theme`                              | `dark`   | `dark` or `light`                                                                            |
| `browser`                            | `chrome` | Browser for the app window: `chrome` or `edge` (if it is not installed, the other one opens) |
| `port`                               | `8080`   | Port of the local web server (1024-65535); if it is in use, a free port is taken             |

`browser` and `port` take effect at the next start.

The encrypted password only works for the same Windows user on the same PC. To prepare a PC, you can write `"password": "..."` into the file by hand; at the next start CameraControl replaces it with the encrypted `passwordProtected`.

Settings and preset pictures that an older version kept next to the program are taken over at the first start.

## Updating

Close CameraControl and replace `CameraControl.exe` with the new version. Settings and presets are kept.

## Uninstalling

1. Close CameraControl and delete `CameraControl.exe`.
2. Delete the folder `%LOCALAPPDATA%\CameraControl` (settings, preset pictures and log).

CameraControl installs nothing else; its temporary files are removed when it closes.

## Troubleshooting

- **"Camera not reachable":** check power, network and the camera address in the settings. CameraControl keeps trying (_Retry connection every_ in the settings) and reconnects by itself.
- **The camera moves but there is no picture:** the live video uses port 4567 of the camera, which a firewall between PC and camera must allow.
- **Another program uses port 8080:** CameraControl then takes a free port by itself. To always use the same port, set _Web server port_ in the settings.
- **Anything else:** look into `%LOCALAPPDATA%\CameraControl\CameraControl.log` and [open an issue](https://github.com/bigmars86/CameraControl/issues/new/choose) with the relevant lines (check them for private data first).

## Security

- The camera password is never sent to the browser and is stored encrypted.
- The local web server answers on `localhost` only and accepts API calls only from its own page, so other websites cannot control the camera or read the settings.
- Please report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

- Committers and reviewers: [bigmars86](https://github.com/bigmars86)
- Approvers: [bigmars86](https://github.com/bigmars86)

Only `CameraControl.exe` is signed, built by the [release workflow](.github/workflows/release.yml) on GitHub-hosted runners from this repository. Every signing request is approved manually.

Privacy policy: This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. CameraControl only connects to the camera address entered in its settings.

## Contributing

Bug reports, ideas and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, how CameraControl works and the release process.

## License

CameraControl is free software under the [GNU General Public License v3.0](LICENSE): you may use, share and change it, also commercially. If you distribute it or a modified version, you must make the source code available to the recipients under the same license. Bundled third-party code keeps its own license, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
