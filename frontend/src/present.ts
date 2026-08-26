/**
 * Hand a streamed document to the browser.
 *
 * This is the LAN half of opening a collateral file: the bridge sent the bytes to THIS device (rather than
 * opening the file on the server, where the person is not), and now the browser has to show or save them.
 * We open the file in a new tab — a PDF renders in the browser's own viewer — and fall back to a download
 * if the tab is blocked, which is never a popup and so always allowed.
 */
export function presentDocument(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const tab = window.open(url, "_blank", "noopener");
  if (!tab) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // Revoke after a beat, so the new tab / download has had time to take the URL before it is freed.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
