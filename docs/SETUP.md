# NIM Hub — Android Setup

Prerequisites: Node.js 22+, Python 3.11+, Android Studio for local Android development, Android SDK compatible with the installed Capacitor release, and an NVIDIA API key for live NIM access.

Keep the NVIDIA key outside source control. For GitHub Actions, follow docs/GITHUB-SETUP.md.

Gateway:
pip install -e '.[test]'
uvicorn nimhub_gateway.main:app --host 127.0.0.1 --port 8787

Android client:
npm install
npm run build
npm run android:add
npm run android:sync

If android/ already exists, do not regenerate it unnecessarily. Build the APK using the native Gradle project.

The Android app is the only release target. The phone app must not contain an NVIDIA API key; use the personal gateway at runtime.