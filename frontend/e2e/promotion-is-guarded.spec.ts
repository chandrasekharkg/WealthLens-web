import { test } from "@playwright/test";

/**
 * Promotion is unreachable without its completed check (ADR-0005/0006)
 *
 * One of exactly THREE sanctioned browser tests (ADR-0010). It is here because a wrong outcome is
 * unrecoverable or dangerous, not because the flow is important. Adding a fourth requires justifying
 * why no cheaper layer can catch that failure.
 *
 * Marked fixme until the flow exists: the placeholder keeps the cap visible in the repo without a red
 * suite that everyone learns to ignore.
 */
test.fixme("Promotion is unreachable without its completed check (ADR-0005/0006)", async () => {
  throw new Error("not implemented — see BUILD-PLAN.md");
});
