export function developmentControlsEnabled(buildFlag: unknown, optInFlag: unknown): boolean {
  return buildFlag === true && optInFlag === "true";
}

export const DEV_CONTROLS_ENABLED = developmentControlsEnabled(
  typeof __DEV__ === "undefined" ? undefined : __DEV__,
  process.env.EXPO_PUBLIC_GATE_DEV_CONTROLS,
);
