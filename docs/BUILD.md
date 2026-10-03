# NIM Hub — Build and CI

## Local targets
Client: `npm install` then `npm run build:client`.
Gateway: Python 3.11+, then `pip install -e '.[test]'` from `services/gateway`, then `pytest`.

## GitHub Actions
CI runs on pushes and pull requests. It checks client type/build and gateway tests. A separate build workflow uploads the client artifact for every successful push.

## Release
Version tags `v*` should produce downloadable client build artifacts. Android package release is deferred until Capacitor is introduced and tested.

## NIM smoke test
An optional scheduled/manual workflow can query NVIDIA `/v1/models` when the repository secret `NVIDIA_API_KEY` is configured. External availability must not make ordinary source CI flaky.

## Philosophy
Artifacts must come from source that CI has tested. Do not hand-build binaries and attach them to the repository.