/**
 * CON-02: guard PIN policy (T-CON-02-U1). Checked before the PIN is sent to the database function that salts
 * and hashes it; this module never stores, logs or returns the PIN, only a reason code.
 */
export type PinRejection = "not_string" | "not_digits" | "length" | "identical" | "sequential";
export type PinCheck = { ok: true } | { ok: false; reason: PinRejection; message: string };

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

const MESSAGES: Record<PinRejection, string> = {
  not_string: "Enter the PIN as digits.",
  not_digits: "The PIN must use digits only.",
  length: `The PIN must be ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits.`,
  identical: "The PIN cannot repeat one digit.",
  sequential: "The PIN cannot be a simple run such as 1234 or 4321.",
};

const reject = (reason: PinRejection): PinCheck => ({
  ok: false,
  reason,
  message: MESSAGES[reason],
});

// Assumption (OQ-39): the sheet rejects "sequential" PINs (1234) yet its own test table accepts 12345, so the
// run check applies to four-digit PINs only.
const SEQUENTIAL_LENGTH = 4;

export function validatePin(pin: unknown): PinCheck {
  if (typeof pin !== "string") return reject("not_string");
  if (!/^[0-9]+$/.test(pin)) return reject("not_digits");
  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) return reject("length");
  if (/^(\d)\1+$/.test(pin)) return reject("identical");
  if (pin.length === SEQUENTIAL_LENGTH) {
    const steps = [...pin].slice(1).map((c, i) => Number(c) - Number(pin[i]));
    if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return reject("sequential");
  }
  return { ok: true };
}
