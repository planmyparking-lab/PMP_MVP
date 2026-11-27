import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CONTACT, Landing } from "../src/components/landing/Landing";
import {
  GATE_TEXT,
  LOT_ZONES,
  initialLot,
  nextLotStep,
} from "../src/components/landing/LandingDemos";
import { isBareLayout, isLandingVisit, showsLanding } from "../src/lib/landingRoute";

describe("landing route rules", () => {
  it("a signed-out visitor may load / ; every other path still goes to /login", () => {
    expect(isLandingVisit("/", false)).toBe(true);
    expect(isLandingVisit("/occupancy", false)).toBe(false);
    expect(isLandingVisit("/", true)).toBe(false);
  });

  it("only a signed-out session sees the landing page; offline keeps the dashboard preview", () => {
    expect(showsLanding("signed-out")).toBe(true);
    expect(showsLanding("offline")).toBe(false);
    expect(showsLanding("ok")).toBe(false);
    expect(showsLanding("denied")).toBe(false);
  });

  it("the landing page and /login render without the Console sidebar; the dashboard keeps it", () => {
    expect(isBareLayout("/login", "signed-out")).toBe(true);
    expect(isBareLayout("/", "signed-out")).toBe(true);
    expect(isBareLayout("/", "ok")).toBe(false);
    expect(isBareLayout("/", "offline")).toBe(false);
    expect(isBareLayout("/shifts", "signed-out")).toBe(false);
  });
});

describe("landing page", () => {
  const html = renderToStaticMarkup(<Landing signIn={<form data-testid="real-login" />} />);

  it("renders the sign-in slot it is given (the real LoginForm in app/page.tsx)", () => {
    expect(html).toContain('data-testid="real-login"');
    expect(html).toContain('id="signin"');
  });

  it("shows the team's LinkedIn page and phone number", () => {
    expect(CONTACT.linkedin).toBe("https://www.linkedin.com/company/planmyparking/");
    expect(html).toContain(`href="${CONTACT.linkedin}"`);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("+91 82920 55416");
    expect(html).toContain('href="tel:+918292055416"');
  });

  it("every in-page link points at a section that exists", () => {
    const targets = [...html.matchAll(/href="#([a-z-]+)"/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(0);
    for (const id of new Set(targets)) expect(html).toContain(`id="${id}"`);
  });

  it("labels the demos as examples, not live data", () => {
    expect(html).toContain("animated example, not live data");
    expect(html).toContain("Example screen");
    expect(html).toContain("Example numbers");
  });
});

describe("gate phone demo text matches the gate app", () => {
  const read = (lang: string) =>
    JSON.parse(
      readFileSync(join(__dirname, "../../gate/src/i18n", `${lang}.json`), "utf8"),
    ) as Record<string, Record<string, string>>;

  it.each(["en", "hi"] as const)("%s strings are the gate app's own", (lang) => {
    const g = read(lang);
    const t = GATE_TEXT[lang];
    expect(t.title).toBe(g.exit.title);
    expect(t.offline).toBe(g.banner.offline);
    expect(t.class).toBe(g.exit.class);
    expect(t.classValue).toBe(g.classes.Car);
    expect(t.zone).toBe(g.exit.zone);
    expect(t.duration).toBe(g.exit.duration);
    expect(t.fare).toBe(g.exit.amountDue);
    expect(t.choose).toBe(g.exit.choosePayment);
    expect(t.cash).toBe(g.payment.cash);
    expect(t.upi).toBe(g.payment.upi);
    expect(t.pass).toBe(g.payment.pass);
    expect(t.waive).toBe(g.payment.waive);
    expect(t.upiHint).toBe(g.payment.upiHint);
  });
});

describe("example lot animation", () => {
  it("starts from the same deterministic lot every time (server and client match)", () => {
    const lot = initialLot();
    expect(lot.map((z) => z.filter(Boolean).length)).toEqual([11, 14, 7]);
    expect(lot.map((z) => z.length)).toEqual(LOT_ZONES.map((z) => z.capacity));
    expect(initialLot()).toEqual(lot);
  });

  it("moves exactly one car per step and keeps every zone between 40% and 100% full", () => {
    let lot = initialLot();
    let seed = 7;
    for (let i = 0; i < 500; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const step = nextLotStep(lot, seed);
      if (!step) continue;
      const changed = step.lot.flat().filter((v, k) => v !== lot.flat()[k]).length;
      expect(changed).toBe(1);
      lot = step.lot;
      for (const zone of lot) {
        const share = zone.filter(Boolean).length / zone.length;
        expect(share).toBeGreaterThanOrEqual(0.4 - 1 / zone.length);
        expect(share).toBeLessThanOrEqual(1);
      }
    }
  });
});
