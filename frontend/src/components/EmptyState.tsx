import type { Formatter } from "../i18n";

/**
 * The three kinds of empty, which are not interchangeable.
 *
 * An unreachable store drawn as an empty table is indistinguishable from genuinely owning nothing — and a
 * household reading "no holdings" when their store was merely locked has been told something false about
 * their money (report-views spec). So the kind is explicit and each carries its own recovery.
 */
export type EmptyKind =
  | { readonly kind: "nothing-yet" }
  | { readonly kind: "nothing-matches"; readonly total: number }
  | { readonly kind: "unavailable"; readonly reason: string };

export function EmptyState({ state, format }: { state: EmptyKind; format: Formatter }) {
  const { t } = format;
  if (state.kind === "nothing-matches") {
    // Saying how many exist unfiltered is what stops this reading as "you have nothing".
    return <p role="status">{t("empty.filtered", { total: state.total })}</p>;
  }
  if (state.kind === "unavailable") {
    return (
      <p role="alert" data-tone="warning">
        {t("empty.unavailable", { reason: state.reason })}
      </p>
    );
  }
  return <p role="status">{t("empty.noData")}</p>;
}
