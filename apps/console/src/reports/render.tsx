import { renderToStaticMarkup } from "react-dom/server";
import { validateReportData } from "../lib/reports/model";
import type { ReportData, ReportType } from "../lib/reports/model";
import { assertNoVehicleNumbers } from "../lib/reports/privacy";
import { DailyReport } from "./templates/daily";
import { MonthlyReport } from "./templates/monthly";
import { WeeklyReport } from "./templates/weekly";

const TEMPLATES: Record<ReportType, (props: { data: ReportData }) => React.JSX.Element> = {
  daily: DailyReport,
  weekly: WeeklyReport,
  monthly: MonthlyReport,
};

/**
 * Renders a report to a complete HTML page (the input to the later PDF step). Throws a RangeError if the data
 * is malformed or contains something that looks like a vehicle number; it never renders a partial page.
 */
export function renderReportHtml(data: ReportData): string {
  validateReportData(data);
  assertNoVehicleNumbers(data);
  const Template = TEMPLATES[data.type];
  return `<!doctype html>${renderToStaticMarkup(<Template data={data} />)}`;
}
