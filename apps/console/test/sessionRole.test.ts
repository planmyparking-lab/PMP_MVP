import { describe, expect, it } from "vitest";
import { roleOnFacility } from "../src/lib/session";
import type { MembershipRow } from "../src/lib/session";

// Review of #66: the role on one facility must follow is_member() in 0010, not "owns any facility".
const X = { id: "fx", orgId: "o1" };
const Y = { id: "fy", orgId: "o1" };
const OTHER_ORG = { id: "fz", orgId: "o2" };

describe("roleOnFacility", () => {
  it("an owner of X who manages Y is a manager on Y and an owner on X", () => {
    const m: MembershipRow[] = [
      { orgId: "o1", facilityId: "fx", role: "owner" },
      { orgId: "o1", facilityId: "fy", role: "manager" },
    ];
    expect(roleOnFacility(m, X)).toBe("owner");
    expect(roleOnFacility(m, Y)).toBe("manager");
  });

  it("an organisation-wide owner owns every facility of that organisation only", () => {
    const m: MembershipRow[] = [{ orgId: "o1", facilityId: null, role: "owner" }];
    expect(roleOnFacility(m, Y)).toBe("owner");
    expect(roleOnFacility(m, OTHER_ORG)).toBeNull();
  });

  it("guard memberships and memberships on other facilities give no role", () => {
    const m: MembershipRow[] = [
      { orgId: "o1", facilityId: "fy", role: "guard" },
      { orgId: "o1", facilityId: "fx", role: "manager" },
    ];
    expect(roleOnFacility(m, Y)).toBeNull();
  });
});
