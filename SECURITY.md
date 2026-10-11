# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately via [GitHub security advisories](https://github.com/bigmars86/CameraControl/security/advisories/new), not as a public issue. You will get an answer as soon as possible.

## Supported versions

Only the latest release gets fixes.

## How CameraControl handles credentials

- The camera password is stored in `%LOCALAPPDATA%\CameraControl\camera_config.json`, encrypted with Windows DPAPI: only the same Windows user on the same PC can decrypt it. It is never sent to the browser and never written to the log.
- The local web server listens on `localhost` only, serves only the app's own files and rejects API requests from other websites (`Sec-Fetch-Site` / `Origin` check), so a web page cannot control the camera or read the settings. Uploaded preset pictures are checked (image type, size, file name) before they are stored.
- Settings, logs and preset pictures are never part of the repository. pre-commit and CI scan for secrets with [gitleaks](https://github.com/gitleaks/gitleaks).
- Release EXEs are built by GitHub Actions and come with a SHA-256 checksum and a build provenance attestation, see also the [code signing policy](README.md#code-signing-policy).
