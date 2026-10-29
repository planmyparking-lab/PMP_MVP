import { createRequire } from "node:module";
import { validateReportData } from "../lib/reports/model";
import type { ReportData, ReportType } from "../lib/reports/model";
import { assertNoVehicleNumbers } from "../lib/reports/privacy";
import { DailyReport } from "./templates/daily";
import { MonthlyReport } from "./templates/monthly";
import { WeeklyReport } from "./templates/weekly";

// Next.js refuses a static import of react-dom/server inside an app route, and its server bundle swaps in a
// variant without renderToStaticMarkup. This code only runs in Node (report route, tests), so the real module
// is loaded at run time, out of the bundler view.
const REACT_DOM_SERVER = "react-dom/server";
const { renderToStaticMarkup } = createRequire(import.meta.url)(
  REACT_DOM_SERVER,
) as typeof import("react-dom/server");

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
