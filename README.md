# NIM Hub

Personal NVIDIA-first AI workstation for Android.

NIM Hub is a personal-use project first. The only product target is Android. React/TypeScript/Vite is the UI layer inside the Android application; standalone web, desktop and iOS releases are out of scope.

## Mission
Unify NVIDIA NIM chat/reasoning/vision, image generation/editing, video, ASR/TTS voice, agent tools, MCP, GitHub, files/artifacts, conversations and lightweight memory in one Android workstation.

## Architecture
Android APK (Capacitor + React/TypeScript) -> personal FastAPI gateway -> NVIDIA NIM / Speech / Visual APIs + MCP tools.

Long-lived NVIDIA/GitHub credentials are never shipped inside the APK.

## Build
Every push runs Android APK CI and verifies an installable debug APK.

Version tags starting with v run Android APK Release. The workflow publishes the APK itself as a .apk asset on the GitHub Release page. No project-created ZIP/TAR wraps the APK.

Manual release builds are available from Actions -> Android APK Release -> Run workflow.

Read AGENTS.md, CLINE.md, docs/MASTER-PROMPT.md, docs/MASTER-SPEC.md, docs/BUILD.md and docs/GITHUB-SETUP.md first.