# Engineering lessons learned

This file is part of the RAIDER failure-memory loop.

For every significant defect, deployment failure, security issue or near miss, record:

1. what happened;
2. the root cause;
3. why existing controls did not catch it;
4. the fix;
5. the reusable prevention rule added to code, CI, tests or documentation.

Do not turn this file into a raw error-log dump. The goal is institutional memory that prevents repeated mistakes.


## 2026-09-24 — Compose BOM exceeded the initial compile SDK

**What happened:** the first Android blueprint CI failed during AAR metadata validation.

**Root cause:** the September 2026 Compose BOM resolved Compose 1.12.1 and Lifecycle 2.11.0, whose metadata requires compileSdk 37 or newer, while the blueprint compiled against API 36.

**Why the control worked:** AppFactory validates the blueprint itself in CI before any product repository is provisioned, so the incompatibility never reached a generated application.

**Fix:** compile against API 37 while retaining targetSdk 36 until the product deliberately adopts the newer runtime behavior.

**Prevention rule:** whenever the Android dependency baseline is upgraded, the blueprint CI must run AAR metadata validation as part of lint/test/assemble; never infer compileSdk compatibility from targetSdk requirements.

## 2026-09-24 — Generated workflows used deprecated Node 20 action runtimes

**What happened:** CI warned that older GitHub Action majors were being force-run on Node 24 because their bundled Node 20 runtime is deprecated.

**Root cause:** the first blueprint draft reused action majors from older Trigenys workflows.

**Fix:** new Android workflows use the current action majors: checkout v7, setup-node v7 where applicable, setup-java v6, Gradle Actions v6 and upload-artifact v7.

**Prevention rule:** a newly introduced blueprint must pin supported current action majors; deprecation warnings are treated as engineering debt, not harmless log noise.
