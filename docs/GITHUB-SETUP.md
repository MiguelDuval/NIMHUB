# NIM Hub — GitHub setup

## NVIDIA API key
Open https://build.nvidia.com/settings/api-keys

Create/copy your NVIDIA API key and treat it as a password. Do not paste it into source code, a committed .env file, workflow YAML, or the APK.

## Add it to GitHub
Open the repository MiguelDuval/NIMHUB.
Go to: Settings -> Secrets and variables -> Actions -> Secrets -> New repository secret.

Name: NVIDIA_API_KEY
Secret: paste the NVIDIA API key, then choose Add secret.

GitHub documentation: https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets

## Test NVIDIA from GitHub
Open Actions -> NVIDIA NIM smoke test -> Run workflow.
The smoke test uses secrets.NVIDIA_API_KEY to call NVIDIA /v1/models and does not put the key into the APK.

## Get an APK
No release is required. Push any commit to GitHub. Android APK CI starts automatically.
Open the resulting workflow run. After the build succeeds, the run summary contains a blue Download APK link and an artifact named NIM-Hub-APK.
The artifact contains one file: NIM-Hub.apk.

Clicking the artifact/link downloads GitHub's artifact package. GitHub controls that outer packaging even though the artifact contains only the APK.

## Routine development
You do not need to create a tag. You do not need to create a GitHub Release. A push is enough.
## Physical Android + LAN gateway

For a phone on the same LAN as the gateway computer, keep local binding secure by default and opt in to LAN exposure:

```env
NIM_HUB_HOST=0.0.0.0
NIM_HUB_PORT=8787
NIM_HUB_ALLOWED_ORIGINS=http://localhost:5173,http://localhost,https://localhost
```

Start the gateway on that LAN interface (or configure your launcher to use these settings), allow inbound TCP 8787 in the computer firewall when prompted, then enter the computer's LAN URL in the Android app, for example `http://192.168.1.10:8787`.

Do not expose the gateway port to the public internet. Use HTTPS for a hardened non-local deployment.
