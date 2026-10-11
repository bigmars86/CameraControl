# Contributing

Thanks for your interest! Bug reports, ideas and pull requests are welcome. By contributing you agree that your contribution is licensed under the project's license ([GPL-3.0](LICENSE)).

## Setup

Requirements: Windows with Windows PowerShell 5.1 and PowerShell 7 (`pwsh`), Python 3, Node.js, Google Chrome or Microsoft Edge.

```powershell
pip install -r requirements-dev.txt
pre-commit install
Install-Module PSScriptAnalyzer -Scope CurrentUser
```

`pre-commit` then checks every commit: formatting (Prettier), linting (ESLint, PSScriptAnalyzer), workflow security (zizmor, schema checks), secrets (gitleaks) and the commit message. Run all checks with `pre-commit run --all-files`.

## Run and build

```powershell
# Run from source (opens Chrome or Edge, stops when the window is closed)
powershell -ExecutionPolicy Bypass -File proxy-server.ps1 -Launch

# Separate settings and presets for testing, another port (instead of the port setting); open http://localhost:8099/
# and stop with Ctrl+C
powershell -ExecutionPolicy Bypass -File proxy-server.ps1 -DataDir "$env:TEMP\cc-test" -Port 8099

# Build CameraControl.exe
powershell -ExecutionPolicy Bypass -File build.ps1 -Version 1.2.3
```

Like the EXE, the source version keeps settings, preset pictures and log in `%LOCALAPPDATA%\CameraControl` unless you pass `-DataDir`.

## Commit messages

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org) (`type(scope): description`, e.g. `fix(ptz): stop zoom reliably`). They decide the next version and make up the release notes:

| Type                                                         | Release notes    | Version                |
| ------------------------------------------------------------ | ---------------- | ---------------------- |
| `feat`                                                       | Features         | minor (1.2.0 -> 1.3.0) |
| `fix`                                                        | Bug fixes        | patch (1.2.0 -> 1.2.1) |
| `perf`                                                       | Performance      | patch                  |
| `!` after the type (`feat!:`) or a `BREAKING CHANGE:` footer | Breaking changes | major (1.2.0 -> 2.0.0) |
| `docs`, `refactor`, `test`, `build`, `ci`, `chore`, `style`  | not listed       | none                   |

The `commit-msg` hook checks the format. Preview the next release with `git cliff --bumped-version` and `git cliff --unreleased --bump` (configuration: [cliff.toml](cliff.toml)).

## Conventions

- `.ps1` files must stay ASCII-only: Windows PowerShell 5.1 reads files without BOM as ANSI (a pre-commit hook checks this).
- `js/websocket.js` is vendored third-party code. Keep changes minimal, mark them with `// patched:` and do not reformat the file.
- Never commit `camera_config.json`, logs, credentials or preset pictures of real locations.
- UI texts go into all three files in `lang/`; `index.html` keeps the English text as fallback.

## How it works

```
Browser (app window)
  |  http://localhost:8080/  (UI files and /api/*)
  v
proxy-server.ps1  (PowerShell HttpListener)
  |  http://<camera>/cgi-bin/ptzctrl.cgi  (Digest or Basic auth)
  v
IP camera (Xiongmai/XMEye firmware)

Browser --- ws://<camera>:4567/ws/ ---> camera  (video, directly, not through the proxy)
```

- `build.ps1` embeds the web files and `proxy-server.ps1` into `CameraControl.exe` (ps2exe). At start the EXE extracts the web files to `%TEMP%\CameraControl`, starts the proxy (on the `port` setting, or a free port if that is taken) and opens Chrome or Edge (`browser` setting) with a temporary profile. When the window is closed, it removes both and exits.
- The proxy checks the camera in the background every `retryInterval` seconds, so it starts even when the camera is off; `/api/health` reports the state to the UI.
- Video: the camera streams H.264 through its own RTSP-over-WebSocket protocol on port 4567. `js/websocket.js` is the [Streamedian](https://github.com/Streamedian/html5_rtsp_player) player from the camera's web interface, patched to skip the AAC audio track, hand video to the decoder every 100 ms, seek to the live edge and stop cleanly. A `<video>` fed by Media Source Extensions never catches up by itself, so `keepLive()` in `js/camera.js` plays slightly faster when behind, jumps to live beyond `maxDelay` and restarts a stalled stream.
- The camera cannot report its position: presets are the only way to return to a position.

### Local API

`/api/*` calls are only accepted from the app's own page (checked via the `Sec-Fetch-Site` and `Origin` headers). Camera commands answer `503` while the camera is not reachable.

| Request                            | Purpose                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /api/settings.js`             | Settings as `window.CAMERA_SETTINGS = {...}`, never with the password                   |
| `POST /api/settings`               | Change settings: JSON with keys from the settings table; `password` sets a new password |
| `GET /api/health`                  | `{"connected": true, "pending": false, "configured": true}`                             |
| `POST /api/ptz`                    | Move `{"code": "Up", "arg1": 5, "arg2": 5}` or stop `{"action": "stop", "code": "Up"}`  |
| `POST /api/presets/{n}/call`       | Move to camera preset n (1-255)                                                         |
| `POST /api/presets/{n}/save`       | Store the current position in camera preset n                                           |
| `GET /api/presets`                 | `{"folder": "...", "presets": [{"slot": 5, "key": "1", "file": "1-5.jpg"}]}`            |
| `PUT /api/presets/{n}/image?key=k` | Store the body (JPEG, PNG, GIF or WebP, at most 5 MB) as the picture of preset n        |
| `DELETE /api/presets/{n}/image`    | Remove the picture of preset n                                                          |
| `POST /api/presets/folder`         | Open the preset folder in Explorer                                                      |
| `GET /presets/<file>`              | A preset picture                                                                        |

PTZ codes: `Up`, `Down`, `Left`, `Right`, `LeftUp`, `RightUp`, `LeftDown`, `RightDown`, `ZoomTele`, `ZoomWide`; speeds 1-10.

### Camera CGI

```
GET /cgi-bin/ptzctrl.cgi?ptzcmd&{command}&{pan speed}&{tilt speed}   # up, down, left, right, leftup, rightup,
                                                                    # leftdown, rightdown, zoomin, zoomout, ptzstop
GET /cgi-bin/ptzctrl.cgi?ptzcmd&poscall&{n}                         # go to preset n
GET /cgi-bin/ptzctrl.cgi?ptzcmd&posset&{n}                          # store the current position as preset n
```

All commands answer `200` with an empty body.

## Releases

Releases are made by the [release workflow](.github/workflows/release.yml): _Actions → Release → Run workflow_ on `main`. It

1. determines the next version from the commits since the last release (the first release is 1.0.0) and stops if there is no `feat`, `fix` or `perf` commit,
2. builds `CameraControl.exe` with that version,
3. has it signed via SignPath once that is set up (see below; approve the signing request in SignPath within one hour, otherwise nothing is published),
4. creates the tag and the GitHub release with the release notes, the EXE, its SHA-256 checksum and a build provenance attestation.

To rebuild, sign and replace the files of an existing release, run the workflow with its tag (e.g. `v1.0.0`) as input.

### Code signing (SignPath Foundation)

Signing is skipped, and releases stay unsigned, until these settings exist under _Settings → Secrets and variables → Actions_:

| Name                           | Kind     | Value                                                        |
| ------------------------------ | -------- | ------------------------------------------------------------ |
| `SIGNPATH_ORGANIZATION_ID`     | variable | SignPath organization ID                                     |
| `SIGNPATH_PROJECT_SLUG`        | variable | SignPath project slug                                        |
| `SIGNPATH_SIGNING_POLICY_SLUG` | variable | SignPath signing policy slug                                 |
| `SIGNPATH_API_TOKEN`           | secret   | API token of a SignPath user who may submit signing requests |

In SignPath, link the project to the trusted build system _GitHub.com_ and use this artifact configuration. It enforces the product name and the version of the release:

```xml
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <parameters>
    <parameter name="version" required="true" />
  </parameters>
  <zip-file>
    <pe-file path="CameraControl.exe" product-name="CameraControl" product-version="${version}">
      <authenticode-sign />
    </pe-file>
  </zip-file>
</artifact-configuration>
```
