# Code signing

OnTop's installers are not code-signed yet. That is why Windows SmartScreen says "Windows protected your PC" and macOS says the app is from an unidentified developer. Signing needs a certificate issued to a verified person or organisation, so it can't be done from the repository alone.

## What signing changes

- **Windows:** the installer shows a verified publisher instead of "Unknown publisher". SmartScreen warnings fade as the signed installer builds up download reputation; no certificate removes them instantly for a new app.
- **macOS:** with an Apple Developer ID and notarization, the app opens normally with no Gatekeeper warning.

## Options

| Platform | Route | Cost (approx.) | Notes |
|---|---|---|---|
| Windows | [SignPath Foundation](https://signpath.org) | Free for open-source projects | Apply with the repository; they sign release builds from CI |
| Windows | [Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/) | Monthly subscription | Identity validation required; check current eligibility for individuals in your country |
| Windows | Certificate authority (e.g. Certum open-source code signing) | Yearly fee | Since 2023 keys must live on a hardware token or cloud HSM |
| macOS | [Apple Developer Program](https://developer.apple.com/programs/) | USD 99 / year | Gives a Developer ID certificate and notarization |

## Turning it on

Builds are ready to sign; they only need the credentials.

**Windows (certificate file, `.pfx`)**
1. In GitHub: *Settings → Secrets and variables → Actions*.
2. Add the secrets `WIN_CSC_LINK` (the `.pfx` file, base64-encoded) and `WIN_CSC_KEY_PASSWORD`.
3. Add the repository variable `WINDOWS_SIGNING` = `true`.
4. Publish a release: the `windows` job in `.github/workflows/release.yml` builds, signs and attaches `OnTop-Setup-x.y.z.exe`.

Locally, the same works by setting `CSC_LINK` and `CSC_KEY_PASSWORD` before `npm run dist`. For Azure Trusted Signing or a cloud HSM, add `win.azureSignOptions` (or a custom `win.sign` script) in `package.json`; see the [electron-builder code signing docs](https://www.electron.build/code-signing).

**macOS (Developer ID)**
1. Export the Developer ID Application certificate as `.p12` and add it as `CSC_LINK` / `CSC_KEY_PASSWORD` secrets.
2. Add `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for notarization.
3. In the `mac` job, remove `CSC_IDENTITY_AUTO_DISCOVERY: false`, pass the secrets as environment variables, and set `"hardenedRuntime": true` and `"notarize": true` under `build.mac` in `package.json`.
