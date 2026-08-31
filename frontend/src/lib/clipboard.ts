/**
 * Put text on the clipboard, working OUTSIDE a secure context too.
 *
 * `navigator.clipboard` only exists on HTTPS or localhost/127.0.0.1 — so on the LAN URL a household reaches
 * over plain HTTP (e.g. http://aipc.local:8765) it is `undefined`, and a bare `navigator.clipboard.writeText`
 * throws. The execCommand('copy') path is the legacy fallback that still works there.
 */
export async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* present but permission-denied — fall through to the execCommand path */
    }
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
