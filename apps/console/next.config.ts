import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@pmp/contracts", "@pmp/domain"],
  // Loaded at run time by the report route; bundling them breaks Chromium's binary lookup.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core", "exceljs"],
};

export default nextConfig;
