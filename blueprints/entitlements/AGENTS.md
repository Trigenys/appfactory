# Agent instructions

This repository follows the Trigenys RAIDER engineering standard. Changes must remain reusable, configuration-driven, idempotent where state is reconciled, non-regressive, least-privilege, testable and adoptable by existing consumers.

Before risky changes, review `docs/engineering/lessons-learned.md`. Significant failures or near misses require a root-cause note and a proportionate prevention mechanism.

For entitlement security, never move `ADMIN_API_KEY`, `SERVICE_API_KEY` or the Ed25519 private signing key into a desktop, mobile or browser client.
