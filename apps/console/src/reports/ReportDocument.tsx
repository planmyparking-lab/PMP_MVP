import { formatRupees } from "@pmp/contracts";
import { formatIstDateTime, formatIstPeriod } from "../lib/format";
import { NO_DATA_MESSAGE } from "../lib/reports/model";
import type { ReportCell, ReportData, ReportTable } from "../lib/reports/model";
import { REPORT_CSS } from "./printStyles";

function cellText(cell: ReportCell): string {
  if (typeof cell === "string") return cell;
  if (typeof cell === "number") return cell.toLocaleString("en-IN");
  return formatRupees(cell.paise);
}

const isNumeric = (cell: ReportCell) => typeof cell !== "string";

function Table({ table }: { table: ReportTable }) {
  return (
    <table>
      <thead>
        <tr>
          {table.columns.map((c, i) => (
            <th key={i} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j} className={isNumeric(cell) ? "num" : undefined}>
                {cellText(cell)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode | null }) {
  return (
    <section className="report-section">
      <h2>{title}</h2>
      {children ?? <p className="no-data">{NO_DATA_MESSAGE}</p>}
    </section>
  );
}

const tableOrNull = (table?: ReportTable) =>
  table && table.rows.length > 0 ? <Table table={table} /> : null;

const REASON_LABEL = (code: string) => {
  const text = code.toLowerCase().replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** The one layout shared by the daily, weekly and monthly templates. */
export function ReportDocument({ data, title }: { data: ReportData; title: string }) {
  const period = formatIstPeriod(data.period.start, data.period.end);
  const generated = formatIstDateTime(data.generatedAt);
  const s = data.sections;
  const overrides =
    s.overridesByReason && s.overridesByReason.length > 0 ? s.overridesByReason : null;
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>{`${title} - ${data.facilityName}`}</title>
        <style dangerouslySetInnerHTML={{ __html: REPORT_CSS }} />
      </head>
      <body>
        <header className="running-header">
          <strong>{data.facilityName}</strong> | {title} | {period} (IST)
        </header>
        <main>
          <h1>{title}</h1>
          <p className="meta">
            Facility: {data.facilityName}
            <br />
            Period: {period} (IST)
            <br />
            Generated: {generated}
          </p>

          <Section title="Utilisation by zone">{tableOrNull(s.utilisationByZone)}</Section>

          <Section title="Revenue declared by mode">
            {s.revenueByMode ? (
              <>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Mode</th>
                      <th scope="col">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Cash</td>
                      <td className="num">{formatRupees(s.revenueByMode.cash)}</td>
                    </tr>
                    <tr>
                      <td>UPI declared (attested by the guard)</td>
                      <td className="num">{formatRupees(s.revenueByMode.upiDeclared)}</td>
                    </tr>
                    <tr>
                      <td>Pass</td>
                      <td className="num">{formatRupees(s.revenueByMode.pass)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="note">
                  UPI amounts are declared by the guard. ParkOS cannot confirm that a payment
                  arrived.
                </p>
              </>
            ) : null}
          </Section>

          <Section title="Peak-hour heatmap">{tableOrNull(s.peakHourHeatmap)}</Section>
          <Section title="Average stay distribution">{tableOrNull(s.stayDistribution)}</Section>

          <Section title="Overrides by reason">
            {overrides ? (
              <table>
                <thead>
                  <tr>
                    <th scope="col">Reason</th>
                    <th scope="col">Overrides</th>
                  </tr>
                </thead>
                <tbody>
                  {overrides.map((o) => (
                    <tr key={o.reasonCode}>
                      <td>{REASON_LABEL(o.reasonCode)}</td>
                      <td className="num">{o.count.toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </Section>

          <Section title="Shift variances">{tableOrNull(s.shiftVariances)}</Section>
          <Section title="Conflicts">{tableOrNull(s.conflicts)}</Section>
        </main>
        <footer className="running-footer">
          {data.facilityName} | Generated {generated} | All times IST
        </footer>
      </body>
    </html>
  );
}
