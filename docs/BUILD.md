# NIM Hub — Android Build and CI

## Product output
The only product build is an Android APK.

## Every push
android-ci.yml runs on every push and pull request.

It installs Node 22 and Java 21; configures the Android SDK; accepts licenses; installs required API/build tools; installs JavaScript dependencies; builds the React/Vite layer; creates/syncs the Capacitor Android platform; runs assembleDebug; verifies the APK; uploads exactly one APK file as the GitHub Actions artifact NIM-Hub-APK; writes a Download APK link into the run summary; and runs gateway tests.

## APK artifact
The artifact contains exactly NIM-Hub.apk.

The workflow uses the current upload-artifact unarchived mode (`archive: false`) so the single APK is uploaded as-is. The artifact's download URL is exposed by the action output and shown as the blue Download APK link in the run summary. GitHub requires the viewer to be signed in to access the artifact URL.

## No releases
NIM Hub does not use GitHub Releases for routine development builds. Every push produces the downloadable APK artifact after a successful Android build.

## NVIDIA smoke test
nim-smoke.yml is a separate optional/manual API connectivity test. It does not publish application artifacts.

## Versioning
An Android versioning scheme can be added later inside the Android project. A tag is not required to obtain an APK build.\n## Android gateway networking\n\nCapacitor Android uses a local localhost WebView origin. NIM Hub permits the personal FastAPI gateway to be reached over HTTP on a trusted LAN for development/personal use, while HTTPS remains the preferred hardened deployment mode. The APK enables cleartext/mixed-content networking specifically to support a user-configured LAN gateway URL.\n

## First-time NVIDIA setup

1. Install the APK.
2. Open **Settings** (the dedicated gear button is always visible in the top bar, and a first-run card also opens it).
3. Enter the NVIDIA API key from Build.NVIDIA.com. The default base URL is `https://integrate.api.nvidia.com/v1`.
4. Press **Test & save NVIDIA key**. The app verifies `/models` using Android native HTTP, then stores the key in Android Keystore-backed encrypted app storage.
5. Refresh models or return to Chat. Core Chat/model discovery now works without a local GitHub checkout and without a running gateway.
6. Configure the optional Personal Gateway only when Agent/MCP/GitHub or other server-side tools are needed.

The NVIDIA key is never committed to the repository, packaged into the APK, or stored in localStorage.
