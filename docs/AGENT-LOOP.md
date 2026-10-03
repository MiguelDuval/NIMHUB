# NIM Hub — Agent Loop

Build the Android workstation in small verified slices without requiring routine user testing.

Observe -> plan -> implement -> test -> inspect -> fix -> document -> commit -> push -> continue.

The only product target is Android APK. Do not spend implementation effort on standalone web, desktop or iOS deliverables.

Use existing SDKs/protocols. Verify current NVIDIA and Capacitor APIs against upstream docs.

After each coherent slice run static checks, tests and Android build verification as applicable. Fix failures before committing.

Never place credentials in source or APK. CI secrets may be used only in server-side/smoke-test steps.

Ask only for missing credentials, destructive external actions or genuinely unresolved material product decisions.