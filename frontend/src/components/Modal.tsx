import type { ReactNode } from "react";
import { useEffect } from "react";

/**
 * The shared modal shell (the popup chrome, factored out).
 *
 * A backdrop that closes on click, a dialog that stops the click from reaching it, Escape-to-close, and a
 * head with a title + close affordance. This is deliberately presentation-only: it takes a title string and
 * children, holds no data, and knows nothing about what it frames — so the source popup (Primitive B) and the
 * holding diary (Primitive A) can both render inside it. `size="wide"` widens it for a table; the default is
 * the narrow form a facts list wants. `headExtra` rides the head for a caller's own control (e.g. a view
 * toggle) without the shell needing to know what it is.
 */
export function Modal({
  title,
  onClose,
  closeLabel = "Close",
  size = "narrow",
  headExtra,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly closeLabel?: string;
  readonly size?: "narrow" | "wide";
  readonly headExtra?: ReactNode;
  readonly children: ReactNode;
}) {
  // Escape closes — a modal must be dismissable from the keyboard, not the mouse alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={size === "wide" ? "modal modal--wide" : "modal"}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <div className="modal-head-tail">
            {headExtra}
            <button type="button" className="linklike modal-close" onClick={onClose} aria-label={closeLabel}>
              ×
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
