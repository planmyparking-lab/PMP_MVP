import ExcelJS from "exceljs";
import type { Paise } from "@pmp/contracts";
import { formatIstDateTime, formatIstPeriod } from "../format";
import { NO_DATA_MESSAGE, validateReportData } from "./model";
import { assertNoVehicleNumbers } from "./privacy";
import type { ReportCell, ReportData, ReportTable } from "./model";

/**
 * CON-08: Excel output built from the same ReportData the PDF template renders, one sheet per section, so the
 * two files cannot disagree (T-CON-08-I2). Money cells hold rupees as a number with a two-decimal format;
 * they come from integer paise, so the value is exact to the paisa. A section without data gets a sheet that
 * says "No data for this period." instead of being left out.
 */
const MONEY_FORMAT = "#,##0.00";

const toRupees = (paise: Paise): number => paise / 100;

function cellValue(cell: ReportCell): { value: string | number; money: boolean } {
  if (typeof cell === "object") return { value: toRupees(cell.paise), money: true };
  return { value: cell, money: false };
}

function addTable(sheet: ExcelJS.Worksheet, table: ReportTable | undefined): void {
  if (!table || table.rows.length === 0) {
    sheet.addRow([NO_DATA_MESSAGE]);
    return;
  }
  sheet.addRow([...table.columns]).font = { bold: true };
  for (const row of table.rows) {
    const added = sheet.addRow(row.map((c) => cellValue(c).value));
    row.forEach((c, i) => {
      if (cellValue(c).money) added.getCell(i + 1).numFmt = MONEY_FORMAT;
    });
  }
  sheet.columns.forEach((col, i) => {
    col.width = Math.max(14, String(table.columns[i] ?? "").length + 4);
  });
}

export async function buildReportWorkbook(data: ReportData): Promise<Uint8Array> {
  validateReportData(data);
  assertNoVehicleNumbers(data);
  const wb = new ExcelJS.Workbook();
  wb.creator = "ParkOS";

  const summary = wb.addWorksheet("Summary");
  summary.addRow(["Facility", data.facilityName]);
  summary.addRow(["Report", data.type]);
  summary.addRow(["Period", formatIstPeriod(data.period.start, data.period.end)]);
  summary.addRow(["Generated", formatIstDateTime(data.generatedAt)]);
  summary.getColumn(1).font = { bold: true };
  summary.getColumn(1).width = 14;
  summary.getColumn(2).width = 40;

  const s = data.sections;

  const revenue = wb.addWorksheet("Revenue by mode");
  if (s.revenueByMode) {
    revenue.addRow(["Mode", "Amount (INR)"]).font = { bold: true };
    const rows: [string, number][] = [
      ["Cash", toRupees(s.revenueByMode.cash)],
      ["UPI declared (attested by the guard)", toRupees(s.revenueByMode.upiDeclared)],
      ["Pass", toRupees(s.revenueByMode.pass)],
    ];
    for (const [label, amount] of rows) {
      revenue.addRow([label, amount]).getCell(2).numFmt = MONEY_FORMAT;
    }
    revenue.getColumn(1).width = 40;
    revenue.getColumn(2).width = 16;
  } else {
    revenue.addRow([NO_DATA_MESSAGE]);
  }

  addTable(wb.addWorksheet("Utilisation by zone"), s.utilisationByZone);
  addTable(wb.addWorksheet("Peak-hour heatmap"), s.peakHourHeatmap);
  addTable(wb.addWorksheet("Stay distribution"), s.stayDistribution);

  const overrides = wb.addWorksheet("Overrides");
  if (s.overridesByReason && s.overridesByReason.length > 0) {
    overrides.addRow(["Reason code", "Count"]).font = { bold: true };
    for (const o of s.overridesByReason) overrides.addRow([o.reasonCode, o.count]);
    overrides.getColumn(1).width = 24;
  } else {
    overrides.addRow([NO_DATA_MESSAGE]);
  }

  addTable(wb.addWorksheet("Shift variances"), s.shiftVariances);
  addTable(wb.addWorksheet("Conflicts"), s.conflicts);

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
