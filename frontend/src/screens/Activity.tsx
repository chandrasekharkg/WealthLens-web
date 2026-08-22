import { useEffect, useState } from "react";

import { api, type Job } from "../api/client";
import type { Formatter } from "../i18n";

/**
 * What has run in this session.
 *
 * The honest part is the disclaimer, and it is not a footnote. Job state is held in memory by design
 * (ADR-0002), so this list is empty after a restart — and an empty log that looks like a complete history
 * would be a lie about what happened. It says which it is, and says plainly that the stores are unaffected:
 * a rebuild never touches the live store, and promotion is atomic.
 */
export function Activity({ format }: { format: Formatter }) {
  const { t } = format;
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    void api
      .jobs()
      .then(setJobs)
      .catch(() => setJobs([]));
  }, []);

  return (
    <main>
      <h1>{t("activity.title")}</h1>
      <p>{t("activity.forgotten")}</p>

      {jobs.length === 0 ? (
        <p role="status">{t("activity.none")}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t("column.outcome")}</th>
              <th>{t("import.chooseEntity")}</th>
              <th>{t("column.status")}</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{job.verb}</td>
                <td>{job.entity_id}</td>
                <td data-status={job.outcome ?? job.state}>
                  {job.outcome ?? job.state}
                  {/* A refusal changed nothing, and the gate says which condition stopped it. */}
                  {job.gate ? ` — ${job.gate}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
