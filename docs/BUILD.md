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
An Android versioning scheme can be added later inside the Android project. A tag is not required to obtain an APK build.