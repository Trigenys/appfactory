# Agent instructions

This repository follows the Trigenys RAIDER engineering standard.

Changes must remain reusable, configuration-driven, non-regressive, testable and easy to adopt. Prefer stable Android/Jetpack APIs. Do not add a second library when an existing dependency already owns the capability.

Before risky changes, review `docs/engineering/lessons-learned.md`. Significant failures or near misses require a root-cause note and a proportionate prevention mechanism.

UI changes must keep Compose previews representative and must update or verify Roborazzi golden screenshots when the visual contract changes intentionally.
