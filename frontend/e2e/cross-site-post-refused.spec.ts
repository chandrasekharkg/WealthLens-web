import { test } from "@playwright/test";

/**
 * A cross-site POST is refused (ADR-0004)
 *
 * One of exactly THREE sanctioned browser tests (ADR-0010). It is here because a wrong outcome is
 * unrecoverable or dangerous, not because the flow is important. Adding a fourth requires justifying
 * why no cheaper layer can catch that failure.
 *
 * Marked fixme until the flow exists: the placeholder keeps the cap visible in the repo without a red
 * suite that everyone learns to ignore.
 */
test.fixme("A cross-site POST is refused (ADR-0004)", async () => {
  throw new Error("not implemented — see BUILD-PLAN.md");
});
