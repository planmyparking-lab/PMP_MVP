/**
 * Print stylesheet for the report pages (A4). Whether the running header and footer repeat on every printed
 * page depends on the PDF renderer (a later slice); that is checked by eye in T-CON-08-X2, not here.
 */
export const REPORT_CSS = `
@page { size: A4; margin: 18mm 14mm 18mm 14mm; }
* { box-sizing: border-box; }
html { font-size: 11pt; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; line-height: 1.35; }
h1 { font-size: 20pt; margin: 0 0 4pt; }
h2 { font-size: 13pt; margin: 0 0 6pt; }
.meta { margin: 0 0 14pt; color: #333; }
.report-section { margin: 0 0 16pt; break-inside: avoid; }
.no-data { margin: 0; font-style: italic; color: #555; }
.note { margin: 6pt 0 0; font-size: 9pt; color: #444; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th, td { border: 1px solid #999; padding: 3pt 6pt; text-align: left; vertical-align: top; }
th { background: #eee; }
td.num { text-align: right; }
.running-header, .running-footer { font-size: 9pt; color: #333; }
.running-header { border-bottom: 1px solid #999; padding-bottom: 3pt; margin-bottom: 10pt; }
.running-footer { border-top: 1px solid #999; padding-top: 3pt; margin-top: 10pt; }
@media print {
  .running-header { position: fixed; top: 0; left: 0; right: 0; margin: 0; background: #fff; }
  .running-footer { position: fixed; bottom: 0; left: 0; right: 0; margin: 0; background: #fff; }
  main { padding-top: 22pt; padding-bottom: 22pt; }
}
`;
