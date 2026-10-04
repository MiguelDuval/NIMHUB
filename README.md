# NIM Hub

Personal NVIDIA-first AI workstation for Android.

NIM Hub is a personal-use project first. The only product target is Android. React/TypeScript/Vite is the UI layer inside the Android application; standalone web, desktop and iOS releases are out of scope.

## Build output
Every push to a branch runs the Android APK CI workflow. It builds the Android app and, on a successful APK build, publishes exactly one GitHub Actions artifact named NIM-Hub-APK containing exactly one file: NIM-Hub.apk.

The workflow also writes a blue Download APK link into the run summary that points to that artifact.

There is no release/tag workflow and no project-created ZIP/TAR build package.

Important GitHub limitation: Actions artifacts are exposed by GitHub as archived artifacts when downloaded. NIM Hub places only the APK inside that artifact; GitHub controls the outer download packaging.

## Architecture
Android APK (Capacitor + React/TypeScript) -> Personal FastAPI gateway -> NVIDIA NIM / Speech / Visual services -> MCP tools and GitHub.

Long-lived NVIDIA/GitHub credentials are never shipped inside the APK.

## Start here
Read AGENTS.md, CLINE.md, docs/MASTER-PROMPT.md, docs/MASTER-SPEC.md, docs/BUILD.md, docs/GITHUB-SETUP.md and EGIT.md.
## Phone-first runtime

Install the APK, open **Settings**, enter the NVIDIA API key from Build.NVIDIA.com, and press **Test & save NVIDIA key**. Core model discovery and Chat do not require a GitHub checkout, local repository, or running gateway. The optional gateway is used for Agent/MCP/GitHub and server-side capabilities.
