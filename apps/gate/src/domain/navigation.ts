export type ReturnNavigation = { kind: "back" } | { kind: "replace"; route: "/entry" | "/exit" };

export function afterShiftOpenNavigation(canGoBack: boolean): ReturnNavigation {
  return canGoBack ? { kind: "back" } : { kind: "replace", route: "/entry" };
}

export function afterPassLookupNavigation(canGoBack: boolean): ReturnNavigation {
  return canGoBack ? { kind: "back" } : { kind: "replace", route: "/exit" };
}
