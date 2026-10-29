/**
 * CON-08: HTML to PDF through `puppeteer-core` with `@sparticuz/chromium` (both named in the sheet). The browser
 * is reached through a small interface so tests can stub it; the real launcher loads Chromium lazily, only
 * when a PDF is actually asked for, because it is large and slow to start (cold-start time on Vercel is an
 * open risk, see docs/team/member-03-anamika.md C8 edge cases).
 */
export interface PdfPage {
  setContent(html: string, options: { waitUntil: "load"; timeout: number }): Promise<unknown>;
  pdf(options: {
    format: "A4";
    printBackground: boolean;
    preferCSSPageSize: boolean;
  }): Promise<Uint8Array>;
}
export interface PdfBrowser {
  newPage(): Promise<PdfPage>;
  close(): Promise<void>;
}
export type BrowserLauncher = () => Promise<PdfBrowser>;

export const PDF_TIMEOUT_MS = 30_000;

export const launchChromium: BrowserLauncher = async () => {
  const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
    import("@sparticuz/chromium"),
    import("puppeteer-core"),
  ]);
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  return browser as unknown as PdfBrowser;
};

/** Renders a complete HTML page to an A4 PDF. Always closes the browser; rejects when `timeoutMs` passes. */
export async function renderPdf(
  html: string,
  { launch = launchChromium, timeoutMs = PDF_TIMEOUT_MS } = {},
): Promise<Uint8Array> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let browser: PdfBrowser | undefined;
  let closed = false;
  const close = async () => {
    if (!browser || closed) return;
    closed = true;
    await browser.close().catch(() => undefined);
  };
  const work = (async () => {
    browser = await launch();
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load", timeout: timeoutMs });
      return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    } finally {
      await close();
    }
  })();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("PDF render timed out")), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    work.catch(() => undefined); // a late failure after a timeout must not become unhandled
    await close(); // on a timeout the work may still be running; stop the browser now
  }
}
