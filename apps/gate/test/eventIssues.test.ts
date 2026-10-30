import { describe, expect, it } from "vitest";
import { formatEventIssues } from "../src/data/eventIssues";

describe("formatEventIssues", () => {
  it("formats array paths from the current contracts parser", () => {
    expect(
      formatEventIssues([
        { path: ["payload", "amount_paise"], message: "Invalid input" },
        { path: ["type"], message: "Invalid discriminator" },
      ]),
    ).toBe("payload.amount_paise: Invalid input; type: Invalid discriminator");
  });

  it("formats dotted-string paths from the proposed contracts parser", () => {
    expect(
      formatEventIssues([
        { path: "payload.amount_paise", message: "Invalid input" },
        { path: "", message: "Invalid event" },
      ]),
    ).toBe("payload.amount_paise: Invalid input; : Invalid event");
  });
});
