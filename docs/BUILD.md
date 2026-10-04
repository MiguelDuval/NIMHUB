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

1. Start the gateway on the computer. Keep `NIM_HUB_HOST=127.0.0.1` for local-only use or explicitly bind a trusted LAN interface for a physical Android phone.
2. Set a private `NIM_HUB_ADMIN_TOKEN` in the gateway environment.
3. Open **NIM Hub Settings** in the APK and enter the gateway URL.
4. Press **Test connection**.
5. Enter the NVIDIA API key from Build.NVIDIA.com and the gateway admin token, then press **Connect NVIDIA**.
6. The gateway verifies NVIDIA `/models` before saving the provider credentials. The client then refreshes model discovery; Chat becomes send-ready and Agent becomes available for models with tool-calling capability.

The NVIDIA provider key remains gateway-side. Never put it in the Android project or APK environment.
