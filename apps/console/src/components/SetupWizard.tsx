"use client";

import { useEffect, useMemo, useState } from "react";
import { validatePin } from "../lib/pinPolicy";
import { analyse, draftToJson, emptyDraft, exampleDraft, todayInIst } from "../lib/setupDraft";
import type { SetupDraft } from "../lib/setupDraft";
import { TariffStep } from "./TariffStep";
import { Icon } from "./ui/Icon";
import { Modal } from "./ui/Modal";
import {
  Banner,
  Button,
  Card,
  Field,
  Issue,
  PageHeader,
  Tip,
  UnavailableButton,
} from "./ui/primitives";
import { useToast } from "./ui/Toast";

const STEPS = [
  { title: "Facility", sub: "Details and zones" },
  { title: "Tariffs", sub: "Prices and try a fare" },
  { title: "Time rules", sub: "Grace, night, start date" },
  { title: "Staff & alerts", sub: "PIN policy, overstay" },
  { title: "Review", sub: "Check everything" },
] as const;

const CLASSES = ["Car", "Two-wheeler", "Bus", "Truck"];

export function SetupWizard() {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<SetupDraft>(emptyDraft);
  const [today, setToday] = useState("");
  const [visited, setVisited] = useState<number[]>([0]);
  const [pin, setPin] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const toast = useToast();

  // Today's date is read after mount so the server and browser render the same first frame.
  useEffect(() => setToday(todayInIst()), []);
  const a = useMemo(() => analyse(draft, today), [draft, today]);
  const patch = (p: Partial<SetupDraft>) => setDraft((d) => ({ ...d, ...p }));
  const go = (n: number) => {
    setStep(n);
    setVisited((v) => (v.includes(n) ? v : [...v, n]));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const totalErrors = a.stepErrors[1] + a.stepErrors[2] + a.stepErrors[3] + a.stepErrors[4];
  const warnings = [a.capacityWarning, ...a.classWarnings].filter((w): w is string => !!w);
  const pinCheck = pin === "" ? null : validatePin(pin);

  const download = () => {
    const blob = new Blob([JSON.stringify(draftToJson(draft, today || todayInIst()), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "facility-setup-draft.json";
    link.click();
    URL.revokeObjectURL(url);
    toast("Draft downloaded to your computer.");
  };
  const stepState = (i: number): "done" | "err" | "" => {
    if (i === 4 || !visited.includes(i)) return "";
    return a.stepErrors[(i + 1) as 1 | 2 | 3 | 4] > 0 ? "err" : "done";
  };

  const setZone = (i: number, p: Partial<SetupDraft["zones"][number]>) =>
    patch({ zones: draft.zones.map((z, j) => (j === i ? { ...z, ...p } : z)) });

  return (
    <>
      <PageHeader
        title="Facility setup"
        description="Walk through a new facility's rules and see every problem before anything goes live."
        actions={
          <>
            <Button
              icon="sparkle"
              onClick={() => {
                setDraft(exampleDraft(today || todayInIst()));
                toast("Example values loaded. They are not a real facility.");
              }}
            >
              Load example
            </Button>
            <Button variant="ghost" icon="reset" onClick={() => setResetOpen(true)}>
              Clear all
            </Button>
          </>
        }
      />
      <Banner tone="info" icon="lock" title="Nothing is saved yet">
        This wizard checks your inputs with the real rules, but saving and activation need the
        database, which is not connected. Your entries stay in this browser tab and are lost when
        you leave.
      </Banner>

      <ol className="stepper" aria-label="Setup steps">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <button
              suppressHydrationWarning
              type="button"
              className="step-btn"
              aria-current={step === i ? "step" : undefined}
              onClick={() => go(i)}
            >
              <span className={`step-num ${stepState(i)}`}>
                {stepState(i) === "done" ? (
                  <Icon name="check" size={14} />
                ) : stepState(i) === "err" ? (
                  "!"
                ) : (
                  i + 1
                )}
              </span>
              <span>
                <div className="step-title">{s.title}</div>
                <div className="step-sub hide-sm">{s.sub}</div>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="grid grid-main">
        <div className="stack">
          {step === 0 && (
            <>
              <Card title="Facility details">
                <div className="grid grid-2">
                  <Field
                    id="fac-name"
                    label="Facility name"
                    error={visited.length > 1 ? a.facility.name : undefined}
                  >
                    <input
                      suppressHydrationWarning
                      id="fac-name"
                      className="input"
                      value={draft.name}
                      placeholder="For example, City Centre Mall"
                      onChange={(e) => patch({ name: e.target.value })}
                      aria-invalid={visited.length > 1 && !!a.facility.name}
                    />
                  </Field>
                  <Field
                    id="fac-slots"
                    label="Total parking slots"
                    hint="All slots across every zone."
                    error={draft.slotCount ? a.facility.slotCount : undefined}
                  >
                    <input
                      suppressHydrationWarning
                      id="fac-slots"
                      className="input num"
                      inputMode="numeric"
                      value={draft.slotCount}
                      onChange={(e) => patch({ slotCount: e.target.value })}
                    />
                  </Field>
                </div>
              </Card>
              <Card
                title="Zones"
                subtitle="Each zone has a capacity and one allowed vehicle class"
                action={
                  <Button
                    size="sm"
                    icon="check"
                    onClick={() =>
                      patch({
                        zones: [...draft.zones, { name: "", capacity: "", vehicleClass: "Car" }],
                      })
                    }
                  >
                    Add zone
                  </Button>
                }
              >
                <div className="stack">
                  {draft.zones.map((z, i) => (
                    <div className="row" key={i} style={{ alignItems: "flex-start" }}>
                      <div style={{ flex: "2 1 160px" }}>
                        <Field
                          id={`zone-name-${i}`}
                          label={i === 0 ? "Zone name" : "Name"}
                          error={z.name || z.capacity ? a.zones[i]?.name : undefined}
                        >
                          <input
                            suppressHydrationWarning
                            id={`zone-name-${i}`}
                            className="input"
                            value={z.name}
                            onChange={(e) => setZone(i, { name: e.target.value })}
                          />
                        </Field>
                      </div>
                      <div style={{ flex: "1 1 110px" }}>
                        <Field
                          id={`zone-cap-${i}`}
                          label={i === 0 ? "Capacity" : "Cap."}
                          error={z.capacity || z.name ? a.zones[i]?.capacity : undefined}
                        >
                          <input
                            suppressHydrationWarning
                            id={`zone-cap-${i}`}
                            className="input num"
                            inputMode="numeric"
                            value={z.capacity}
                            onChange={(e) => setZone(i, { capacity: e.target.value })}
                          />
                        </Field>
                      </div>
                      <div style={{ flex: "1 1 140px" }}>
                        <Field id={`zone-class-${i}`} label={i === 0 ? "Vehicle class" : "Class"}>
                          <select
                            suppressHydrationWarning
                            id={`zone-class-${i}`}
                            className="select"
                            value={z.vehicleClass}
                            onChange={(e) => setZone(i, { vehicleClass: e.target.value })}
                          >
                            {CLASSES.map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove zone ${i + 1}`}
                        disabled={draft.zones.length === 1}
                        onClick={() => patch({ zones: draft.zones.filter((_, j) => j !== i) })}
                        style={{ marginTop: 24 }}
                      >
                        <Icon name="x" size={16} />
                      </Button>
                    </div>
                  ))}
                  {a.capacityWarning && (
                    <Issue tone="warn">{a.capacityWarning} This is a warning, not an error.</Issue>
                  )}
                </div>
              </Card>
            </>
          )}

          {step === 1 && (
            <TariffStep draft={draft} analysis={a} onChange={(tariffs) => patch({ tariffs })} />
          )}

          {step === 2 && (
            <Card title="Time rules">
              <div className="stack">
                <div className="grid grid-2">
                  <Field
                    id="grace"
                    label="Grace period (minutes)"
                    hint="Free time before charging starts."
                    error={a.grace}
                  >
                    <input
                      suppressHydrationWarning
                      id="grace"
                      className="input num"
                      inputMode="numeric"
                      value={draft.grace}
                      onChange={(e) => patch({ grace: e.target.value })}
                      aria-invalid={!!a.grace}
                    />
                  </Field>
                  <Field
                    id="eff"
                    label="Tariff starts on"
                    hint="A new tariff cannot start in the past."
                    error={a.effectiveFrom}
                  >
                    <input
                      suppressHydrationWarning
                      id="eff"
                      type="date"
                      min={today}
                      className="input"
                      value={draft.effectiveFrom}
                      onChange={(e) => patch({ effectiveFrom: e.target.value })}
                      aria-invalid={!!a.effectiveFrom}
                    />
                  </Field>
                </div>
                <label className="check">
                  <input
                    suppressHydrationWarning
                    type="checkbox"
                    checked={draft.nightOn}
                    onChange={(e) => patch({ nightOn: e.target.checked })}
                  />
                  <span>Use a night window with its own rate</span>
                </label>
                {draft.nightOn && (
                  <div className="grid grid-2">
                    <Field id="n-start" label="Night starts" error={a.night}>
                      <input
                        suppressHydrationWarning
                        id="n-start"
                        type="time"
                        className="input"
                        value={draft.nightStart}
                        onChange={(e) => patch({ nightStart: e.target.value })}
                        aria-invalid={!!a.night}
                      />
                    </Field>
                    <Field
                      id="n-end"
                      label="Night ends"
                      hint="May be earlier than the start: the window crosses midnight."
                    >
                      <input
                        suppressHydrationWarning
                        id="n-end"
                        type="time"
                        className="input"
                        value={draft.nightEnd}
                        onChange={(e) => patch({ nightEnd: e.target.value })}
                      />
                    </Field>
                  </div>
                )}
                {draft.nightOn && (
                  <div className="grid grid-2">
                    <Field id="n-kind" label="Night rate type">
                      <select
                        suppressHydrationWarning
                        id="n-kind"
                        className="select"
                        value={draft.nightKind}
                        onChange={(e) =>
                          patch({
                            nightKind: e.target.value as SetupDraft["nightKind"],
                            nightValue: "",
                          })
                        }
                      >
                        <option value="surcharge">Fixed surcharge (rupees)</option>
                        <option value="multiplier">Percentage of the fare</option>
                      </select>
                    </Field>
                    <Field
                      id="n-value"
                      label={draft.nightKind === "surcharge" ? "Surcharge (₹)" : "Percentage (%)"}
                      hint="Applies once to a stay that touches the night window."
                      error={a.nightValue}
                    >
                      <input
                        suppressHydrationWarning
                        id="n-value"
                        className="input num"
                        inputMode="decimal"
                        value={draft.nightValue}
                        onChange={(e) => patch({ nightValue: e.target.value })}
                        aria-invalid={!!a.nightValue}
                      />
                    </Field>
                  </div>
                )}
                <p className="small muted">
                  Grace, the night rule and the start date apply to every tariff. The night
                  percentage rule is still provisional in the fare engine.
                </p>
              </div>
            </Card>
          )}

          {step === 3 && (
            <>
              <Card title="Overstay alert" subtitle="Flag vehicles that stay unusually long">
                <Field
                  id="overstay"
                  label="Alert after (minutes)"
                  hint="The smallest allowed value is 30 minutes."
                  error={a.overstay}
                >
                  <input
                    suppressHydrationWarning
                    id="overstay"
                    className="input num"
                    style={{ maxWidth: 200 }}
                    inputMode="numeric"
                    value={draft.overstay}
                    onChange={(e) => patch({ overstay: e.target.value })}
                    aria-invalid={!!a.overstay}
                  />
                </Field>
              </Card>
              <Card
                title="Guard PIN policy"
                subtitle="Try a PIN to see the rules. It is never stored or sent."
              >
                <div className="stack">
                  <Field
                    id="pin"
                    label="Try a PIN"
                    hint="4 to 6 digits. Not one repeated digit, and not a simple run like 1234."
                    error={pinCheck && !pinCheck.ok ? pinCheck.message : undefined}
                    ok={pinCheck?.ok ? "This PIN meets the policy." : undefined}
                  >
                    <input
                      suppressHydrationWarning
                      id="pin"
                      className="input num"
                      style={{ maxWidth: 200 }}
                      type="password"
                      autoComplete="off"
                      inputMode="numeric"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      aria-invalid={!!pinCheck && !pinCheck.ok}
                    />
                  </Field>
                  <p className="small muted">
                    The run rule currently applies to four-digit PINs only. That is a provisional
                    choice awaiting confirmation (OQ-39).
                  </p>
                </div>
              </Card>
            </>
          )}

          {step === 4 && (
            <Card title="Review" subtitle="Everything below comes from the rules, live">
              <div className="stack">
                {totalErrors === 0 ? (
                  <Issue tone="ok">
                    <b>No errors.</b> This configuration passes every rule the Console can check
                    today.
                  </Issue>
                ) : (
                  <Issue tone="bad">
                    <b>
                      {totalErrors} thing{totalErrors === 1 ? "" : "s"} to fix.
                    </b>{" "}
                    Use the steps above to find them.
                  </Issue>
                )}
                {warnings.map((w) => (
                  <Issue key={w} tone="warn">
                    {w}
                  </Issue>
                ))}
                <dl className="kv">
                  <dt>Facility</dt>
                  <dd>
                    {draft.name || "—"} · {draft.slotCount || "—"} slots
                  </dd>
                  <dt>Zones</dt>
                  <dd>
                    {draft.zones
                      .map(
                        (z) => `${z.name || "unnamed"} (${z.capacity || "?"}, ${z.vehicleClass})`,
                      )
                      .join("; ")}
                  </dd>
                  <dt>Tariffs</dt>
                  <dd>
                    {draft.tariffs
                      .map(
                        (t) =>
                          `${t.vehicleClass}: ${t.model === "HOURLY_SLABS" ? `${t.slabs.length} band${t.slabs.length === 1 ? "" : "s"} + repeat` : t.model === "FLAT" ? "flat per day" : "flat per entry"}`,
                      )
                      .join("; ")}
                  </dd>
                  <dt>Grace</dt>
                  <dd>{draft.grace || "—"} minutes</dd>
                  <dt>Night window</dt>
                  <dd>{draft.nightOn ? `${draft.nightStart} to ${draft.nightEnd}` : "Not used"}</dd>
                  <dt>Tariff starts</dt>
                  <dd>{draft.effectiveFrom || "—"}</dd>
                  <dt>Overstay alert</dt>
                  <dd>{draft.overstay || "—"} minutes</dd>
                </dl>
                <hr className="divider" />
                <div className="actions">
                  <Button icon="download" onClick={download} disabled={totalErrors > 0}>
                    Download draft (JSON)
                  </Button>
                  <UnavailableButton
                    icon="rocket"
                    variant="primary"
                    reason="Saving and activating a facility needs the database, sign-in and the setup-draft table, which are not connected yet."
                  >
                    Save and activate
                  </UnavailableButton>
                </div>
                <p className="small muted">
                  The downloaded file is a local draft. It is not saved to any facility and contains
                  no PIN.
                </p>
              </div>
            </Card>
          )}

          <div className="between">
            <Button icon="arrowLeft" disabled={step === 0} onClick={() => go(step - 1)}>
              Back
            </Button>
            {step < 4 ? (
              <Button variant="primary" onClick={() => go(step + 1)}>
                Continue <Icon name="arrowRight" size={16} />
              </Button>
            ) : (
              <Tip text="Activation is unavailable until the backend is connected.">
                <Button
                  variant="primary"
                  aria-disabled="true"
                  aria-label="Activate facility. Unavailable."
                  onClick={() => setActivateOpen(true)}
                >
                  Activate facility
                </Button>
              </Tip>
            )}
          </div>
        </div>

        <aside className="stack" aria-label="Live validation summary">
          <Card title="Live validation" subtitle="Updates as you type">
            <div className="stack-sm">
              {([1, 2, 3, 4] as const).map((n) => (
                <button
                  suppressHydrationWarning
                  key={n}
                  type="button"
                  className="btn btn-ghost"
                  style={{ justifyContent: "space-between" }}
                  onClick={() => go(n - 1)}
                >
                  <span>{STEPS[n - 1].title}</span>
                  <span
                    className={`badge tone-${a.stepErrors[n] > 0 ? "bad" : visited.includes(n - 1) ? "ok" : "off"}`}
                  >
                    {a.stepErrors[n] > 0
                      ? `${a.stepErrors[n]} to fix`
                      : visited.includes(n - 1)
                        ? "Valid"
                        : "Not visited"}
                  </span>
                </button>
              ))}
            </div>
            {warnings.length > 0 && (
              <>
                <hr className="divider" />
                <div className="small muted">
                  {warnings.length} warning{warnings.length === 1 ? "" : "s"}
                </div>
              </>
            )}
          </Card>
          <Card title="What happens next">
            <ol className="checklist small">
              <li>
                <span className="n">1</span>
                <span>Draft saved to the database (not connected)</span>
              </li>
              <li>
                <span className="n">2</span>
                <span>Activation makes the facility live for enrolment</span>
              </li>
              <li>
                <span className="n">3</span>
                <span>Guard phones sync the configuration</span>
              </li>
            </ol>
          </Card>
        </aside>
      </div>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Clear everything?"
        confirm={{
          label: "Clear all",
          danger: true,
          onConfirm: () => {
            setDraft(emptyDraft());
            setPin("");
            setStep(0);
            setVisited([0]);
            toast("Setup cleared.");
          },
        }}
      >
        <p>
          This removes everything you typed in this wizard. Nothing was saved anywhere, so it cannot
          be undone.
        </p>
      </Modal>
      <Modal
        open={activateOpen}
        onClose={() => setActivateOpen(false)}
        title="Activation unavailable"
      >
        <p>
          Activating a facility would make it live for guard phones. That needs the database,
          sign-in and the setup-draft table, which other team members are still building. Your
          inputs are checked here, but nothing was or can be saved yet.
        </p>
      </Modal>
    </>
  );
}
