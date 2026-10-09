# Visual QA — render before done

A completed PR requires **observed rendered evidence**, not merely valid JSX or a passing typecheck.

## Minimum matrix

- Desktop at **1440px** and mobile at **390px**. Add **360px/768px** for fragile responsive components.
- Main landing route and primary conversion path.
- Key sections above the fold and at least one long-scroll state.
- Keyboard navigation, skip link/focus, accessible names and primary CTA reachable with Enter/Space as appropriate.
- `prefers-reduced-motion` actual browser setting or emulation.
- No horizontal overflow, clipped content, missing images or blocked CTA.
- Console errors and failed network requests.
- FR/EN or other supported languages (including long translations).
- Image weight and truthful alt text; externally hosted images reviewed for licensing.
- Baseline vs candidate screenshots to detect layout regressions.

## Performance budgets (consumer-controlled)

Proposed defaults: LCP <= 2500ms, CLS <= 0.10 and TBT <= 200ms, with mobile realistic throttling where appropriate. These are **targets**, not assertions. INP may also be tracked in field or synthetic interactions. Report the test conditions, page URL/commit, device, tool and any exceptions.

Run the consumer's own `typecheck`, tests and build, then a real browser/Playwright/Lighthouse or approved equivalent. The reusable automation workflow is tracked separately in `EagleFox31/appfactory-project-automation#99`. Its existence in the backlog does not mean visual tests have already run.

## Evidence ledger

| Gate | Evidence required | Allowed status |
| --- | --- | --- |
| Build | actual command, commit, exit result | PASS / FAIL / NOT RUN |
| Desktop screenshot | captured render + manual inspection | PASS / FAIL / NOT RUN |
| Mobile screenshot | captured render + overflow inspection | PASS / FAIL / NOT RUN |
| Keyboard/focus | observed interaction | PASS / FAIL / NOT RUN |
| Reduced motion | observed alternate behavior | PASS / FAIL / NOT RUN |
| Performance | tool results and thresholds | PASS / FAIL / NOT RUN |
| Provenance | central approval + consumer notices when reused | PASS / FAIL / NOT APPLICABLE |

**No evidence → NOT RUN.** If the render cannot be inspected, leave the implementation awaiting validation; do not call the landing "wow complete." Keep the distinction between a useful *read-only plan* and a *deployed, verified page* explicit.
