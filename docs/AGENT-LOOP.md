# NIM Hub — Agent Loop

## Goal
Build the workstation in small verified slices without requiring the user to perform routine tests or provide repeated feedback.

## Loop
Observe -> plan -> implement -> test -> inspect -> fix -> document -> commit -> push -> continue.

## Observe
Inspect current branch, repository status, recent commits, docs, source and tests before changing anything.

## Plan
Choose one coherent slice that advances the master specification. Avoid speculative rewrites.

## Implement
Use mature SDKs/protocols. Keep abstractions narrow. Do not leave unnecessary TODO-only scaffolding.

## Verify
Run formatter/linter, type checks, unit tests and production builds for affected apps. For integrations without credentials, use mocked transport and test validation/error mapping/request construction.

## Self-repair
Fix actual failures before moving on. Do not weaken or skip tests just to get green CI.

## Documentation
Update docs when contracts, setup, security, architecture or public behavior changes.

## Interaction
Do not ask the user to run ordinary diagnostics or copy routine logs. Avoid repetitive progress reports. Ask only for missing external credentials, destructive/irreversible actions, or a material unresolved product choice.

## Git
Use focused commits. Push the current feature branch when authenticated. Never rewrite shared history.