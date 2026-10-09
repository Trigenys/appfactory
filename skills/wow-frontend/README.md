# WOW Frontend agent skill

Portable SKILL.md for agents designing or refactoring Trigenys product landings.

## Location

The authoritative skill is [SKILL.md](SKILL.md), with references for [source selection](references/source-selection.md), [composition](references/composition.md), [motion](references/motion.md) and [visual QA](references/visual-qa.md). It lives in **`Trigenys/appfactory`**, not in the Project Automation Action or the landing template.

It can be **read directly from this repository**, or an agent that supports local `SKILL.md` packages can copy this entire `wow-frontend/` directory to the agent-specific skill location (for example `.agents/skills/wow-frontend/` or `.cursor/skills/wow-frontend/`, subject to that agent's actual discovery rules). This repository change does **not** install the skill into remote consumers or any ChatGPT/Cursor account.

The references resolve other AppFactory contracts relative to the **AppFactory repository root**; they are not vendored automatically into consumer repositories. Agents running in another checkout should explicitly find the AppFactory source (or vendor the referenced contracts under a separately approved integration).

## Read-only local planning

From the AppFactory checkout:

```sh
node scripts/wow-frontend-plan.mjs \
  skills/wow-frontend/examples/commerce-factory.brief.json \
  ui-registry/examples/wow-react-vite-css.json
```

The output is a **plan**, not a generated landing. It includes source dispositions, stack-compatibility research references, sequencing, denied installation/copy rights and **NOT RUN** browser/build/QA evidence.

The Commerce Factory example was prepared after inspecting its `README.md`, `package.json`, `src/App.tsx` and `src/styles.css` using read-only GitHub access. It preserves React 19, Vite, TypeScript, existing CSS tokens and FR/EN. No Commerce Factory files, deployments or commercial data were changed.

## Quality

```sh
npm run test:ui-registry
```

This existing CI gate includes tests for the WOW source contract (#139), central approval and provenance policy (#140) and this skill's structure/dry-run behavior (#141). Real screenshot, mobile, keyboard and performance automation are still follow-up work, tracked in [Project Automation #99](https://github.com/EagleFox31/appfactory-project-automation/issues/99).

## Versioning and obligations

- Do not introduce a separate UI component registry: existing `ui-registry/registry.json` remains canonical for native code.
- The external `ui-registry/wow-sources.json` is currently reference-only; central `ui-registry/wow-review-policy.json` has no live approvals.
- Skill instructions **do not** grant import/install permissions or override consumer `AGENTS.md` and repository governance.
- Use RAIDER and include accurate evidence in PRs. A green planning test does not imply production screenshot QA.
