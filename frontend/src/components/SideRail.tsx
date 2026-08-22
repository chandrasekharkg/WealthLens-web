/**
 * The left rail: which tab you are on, and the choices inside it.
 *
 * It belongs to the SHELL rather than to a screen, because the question it answers — "where am I, and what
 * else is here" — is the same on every tab. Reports fills it with its reports today; a member picker or a
 * drill-down trail plugs into the same place without another layout.
 *
 * **A rail with nothing in it is not rendered.** An empty 200px column is real estate spent on decoration,
 * and this app's screens are tables that want the width.
 */

export type RailItem = {
  readonly id: string;
  readonly label: string;
  readonly current: boolean;
  readonly onPick: () => void;
};

export type SideRailProps = {
  /** The tab the reader is on — the rail's own heading. */
  readonly heading: string;
  readonly items: readonly RailItem[];
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly labels: { readonly collapse: string; readonly expand: string };
};

export function SideRail({ heading, items, open, onToggle, labels }: SideRailProps) {
  if (items.length === 0) return null;

  return (
    <aside className="rail" data-open={open} data-print="hide">
      <div className="rail-head">
        {open ? <h2>{heading}</h2> : null}
        <button
          type="button"
          className="rail-toggle"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? labels.collapse : labels.expand}
          title={open ? labels.collapse : labels.expand}
        >
          <span aria-hidden="true">{open ? "«" : "»"}</span>
        </button>
      </div>

      {open ? (
        <nav aria-label={heading}>
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={item.onPick}
                  aria-current={item.current}
                  data-selected={item.current}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </aside>
  );
}
