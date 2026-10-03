# EGIT — Git and collaboration protocol

## Branch policy
- `main` is the integration line.
- Substantial work uses descriptive feature branches such as `work/agent-core` or `work/voice`.
- Never reset, rebase or force-push shared work.

## Commit policy
Use focused commits with prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `build:`, `chore:`.

## Push policy
Normal flow: edit -> verify -> commit -> push -> GitHub Actions -> artifact/status. A successful git push is not evidence of a successful build; CI is.

## Safety
Inspect current state before modifying a sensitive file. Do not overwrite unrelated agent work. Avoid unrelated formatting.

## Autonomous agent rule
The agent may commit and push when following the master specification and checks pass. Ask only for missing external credentials, destructive actions, or an irreversible product decision.