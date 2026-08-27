import { useState } from "react";

import { api, isSessionExpired } from "../api/client";
import type { Formatter } from "../i18n";

/**
 * Put text on the clipboard, working OUTSIDE a secure context too.
 *
 * `navigator.clipboard` only exists on HTTPS or localhost/127.0.0.1 — so on the LAN URL a household reaches over
 * plain HTTP (e.g. http://aipc.local:8765) it is `undefined`, and a bare `navigator.clipboard.writeText` throws
 * "undefined is not an object". The execCommand('copy') path is the legacy fallback that still works there, so
 * Copy behaves the same whether the app is opened on the machine itself or from another device on the network.
 */
async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    if (!document.execCommand("copy")) throw new Error("the copy command was rejected");
  } finally {
    document.body.removeChild(ta);
  }
}

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
      await writeClipboard(value);
      setNote(t("secret.copied"));
    } catch (error: unknown) {
      // A stale token after a server restart is the one failure with a specific fix — say "reload" rather
      // than the opaque "POST … failed". Otherwise: clipboard access is permission-gated in several
      // browsers, so an ordinary failure must still say what happened, not leave a silent button.
      setNote(
        isSessionExpired(error)
          ? t("error.sessionExpired")
          : t("secret.copyFailed", { reason: error instanceof Error ? error.message : "" }),
      );
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
