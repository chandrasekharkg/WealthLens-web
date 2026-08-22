import { useState } from "react";

import { api } from "../api/client";
import type { Formatter } from "../i18n";

/**
 * Release one re-obtainable secret to the clipboard (ADR-0019).
 *
 * It is fetched only when clicked, never held in the page beforehand, and never rendered as text — the
 * user ends up holding it, the screen does not. There is deliberately no equivalent for the store key.
 */
export function CopySecret({
  entity,
  what,
  label,
  format,
}: {
  entity: string;
  what: string;
  label: string;
  format: Formatter;
}) {
  const { t } = format;
  const [note, setNote] = useState<string | null>(null);

  const copy = async () => {
    setNote(null);
    try {
      const { value } = await api.reveal(entity, what);
      await navigator.clipboard.writeText(value);
      setNote(t("secret.copied"));
    } catch (error: unknown) {
      // Clipboard access is permission-gated in several browsers, so a failure here is ordinary and must
      // say what happened rather than leaving a button that silently did nothing.
      setNote(t("secret.copyFailed", { reason: error instanceof Error ? error.message : "" }));
    }
  };

  return (
    <>
      <button type="button" onClick={() => void copy()} aria-label={`${t("secret.copy")} ${label}`}>
        {t("secret.copy")}
      </button>
      {note && <span role="status"> {note}</span>}
    </>
  );
}
