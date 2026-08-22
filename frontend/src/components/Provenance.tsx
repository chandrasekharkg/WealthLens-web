import type { ProvenanceHeader } from "../lib/csv";

/**
 * The header that makes a figure legible away from the app.
 *
 * On screen it is quiet context; on paper it is the only context there is, so it is part of the document
 * rather than part of the chrome — which is why it carries no `data-print="hide"`.
 */
export function Provenance({ header }: { header: ProvenanceHeader }) {
  return (
    <section className="provenance" aria-label="About these figures">
      <h2>{header.title}</h2>
      <p>
        {header.scope} · as of {header.as_of ?? "not specified"} · in {header.reporting_currency}
      </p>
      {header.filters?.length ? <p>Filters: {header.filters.join(" · ")}</p> : null}
      {(header.warnings ?? []).map((warning) => (
        <p className="warning" key={warning} role="note">
          {warning}
        </p>
      ))}
    </section>
  );
}
