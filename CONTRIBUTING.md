# Contributing

Thanks for your interest! Bug reports, ideas and pull requests are welcome. By contributing you agree that your contribution is licensed under the project's license ([CC BY-NC-SA 4.0](LICENSE)).

## Setup

Requirements: Windows with Windows PowerShell 5.1 and PowerShell 7 (`pwsh`), Python 3, Node.js, Google Chrome.

```powershell
pip install -r requirements-dev.txt
pre-commit install
Install-Module PSScriptAnalyzer -Scope CurrentUser
```

`pre-commit` then checks every commit: formatting (Prettier), linting (ESLint, PSScriptAnalyzer), workflow security (zizmor, schema checks) and secrets (gitleaks). Run all checks with `pre-commit run --all-files`.

## Run and build

```powershell
# Run from source (opens Chrome, stops when it is closed)
powershell -ExecutionPolicy Bypass -File proxy-server.ps1 -Launch

# Build CameraControl.exe
powershell -ExecutionPolicy Bypass -File build.ps1 -Version 1.2.3
```

In source mode, settings are stored in `camera_config.json` next to `proxy-server.ps1`; it is in `.gitignore`.

## Conventions

- `.ps1` files must stay ASCII-only: Windows PowerShell 5.1 reads files without BOM as ANSI (a pre-commit hook checks this).
- `js/websocket.js` is vendored third-party code. Keep changes minimal, mark them with `// patched:` and do not reformat the file.
- Never commit `camera_config.json`, logs, credentials or preset images of real locations.
- UI texts go into all three files in `lang/` (and the inline fallback in `js/language.js`).

## Releases

Push a tag `vX.Y.Z` on `main`. The [build workflow](.github/workflows/build.yml) builds `CameraControl.exe` on Windows and publishes a GitHub release with the EXE, its SHA-256 checksum, generated release notes and a build provenance attestation.
