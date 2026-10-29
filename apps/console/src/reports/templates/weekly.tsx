import type { ReportData } from "../../lib/reports/model";
import { ReportDocument } from "../ReportDocument";

/** Weekly report. Same sections as the others until OQ-19 says what each cadence should show. */
export function WeeklyReport({ data }: { data: ReportData }) {
  return <ReportDocument data={data} title="Weekly report" />;
}
