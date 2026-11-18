"use client";

import { useMemo, useState } from "react";
import { tryFare } from "../lib/fareTryIt";
import { newTariff, TARIFF_MODEL_OPTIONS } from "../lib/setupDraft";
import type { Analysis, SetupDraft, TariffDraft } from "../lib/setupDraft";
import { Icon } from "./ui/Icon";
import { Button, Card, Field, Issue, StatusBadge } from "./ui/primitives";

const CLASSES = ["Car", "Two-wheeler", "Bus", "Truck"];

/** Wizard step 2: tariffs in the real IC-04 shape, with a "try a fare" panel that runs the shared fare engine. */
export function TariffStep({
  draft,
  analysis,
  onChange,
}: {
  draft: SetupDraft;
  analysis: Analysis;
  onChange: (tariffs: TariffDraft[]) => void;
}) {
  const set = (i: number, p: Partial<TariffDraft>) =>
    onChange(draft.tariffs.map((t, j) => (j === i ? { ...t, ...p } : t)));
  const setSlab = (i: number, j: number, p: Partial<TariffDraft["slabs"][number]>) =>
    set(i, { slabs: draft.tariffs[i].slabs.map((s, k) => (k === j ? { ...s, ...p } : s)) });

  return (
    <>
      {draft.tariffs.map((t, i) => {
        const fe = analysis.tariffs[i]?.fieldErrors;
        const valid = !!analysis.tariffs[i]?.tariff;
        return (
          <Card
            key={i}
            title={`Tariff ${i + 1}: ${t.vehicleClass || "no class"}`}
            subtitle={TARIFF_MODEL_OPTIONS.find((m) => m.value === t.model)?.help}
            action={
              <div className="actions">
                <StatusBadge tone={valid ? "ok" : "bad"}>
                  {valid ? "Valid" : "Needs attention"}
                </StatusBadge>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={draft.tariffs.length === 1}
                  onClick={() => onChange(draft.tariffs.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            }
          >
            <div className="stack">
              <div className="grid grid-2">
                <Field id={`t-class-${i}`} label="Vehicle class" error={fe?.vehicleClass}>
                  <select
                    suppressHydrationWarning
                    id={`t-class-${i}`}
                    className="select"
                    value={t.vehicleClass}
                    onChange={(e) => set(i, { vehicleClass: e.target.value })}
                  >
                    {CLASSES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field id={`t-model-${i}`} label="Pricing model">
                  <select
                    suppressHydrationWarning
                    id={`t-model-${i}`}
                    className="select"
                    value={t.model}
                    onChange={(e) => set(i, { model: e.target.value as TariffDraft["model"] })}
                  >
                    {TARIFF_MODEL_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {t.model === "HOURLY_SLABS" ? (
                <>
                  <div className="small muted">
                    A stay inside a band pays that band&rsquo;s price. Bands must get longer from
                    top to bottom.
                  </div>
                  {t.slabs.map((s, j) => (
                    <div className="row" key={j} style={{ alignItems: "flex-start" }}>
                      <div style={{ flex: "1 1 140px" }}>
                        <Field id={`s-up-${i}-${j}`} label={j === 0 ? "Up to (minutes)" : "Up to"}>
                          <input
                            suppressHydrationWarning
                            id={`s-up-${i}-${j}`}
                            className="input num"
                            inputMode="numeric"
                            value={s.upTo}
                            onChange={(e) => setSlab(i, j, { upTo: e.target.value })}
                          />
                        </Field>
                      </div>
                      <div style={{ flex: "1 1 140px" }}>
                        <Field id={`s-price-${i}-${j}`} label="Price" error={fe?.slabs[j]}>
                          <div className="input-group">
                            <span className="prefix">₹</span>
                            <input
                              suppressHydrationWarning
                              id={`s-price-${i}-${j}`}
                              className="input num has-prefix"
                              inputMode="decimal"
                              value={s.price}
                              onChange={(e) => setSlab(i, j, { price: e.target.value })}
                              aria-invalid={!!fe?.slabs[j]}
                            />
                          </div>
                        </Field>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove band ${j + 1}`}
                        disabled={t.slabs.length === 1}
                        onClick={() => set(i, { slabs: t.slabs.filter((_, k) => k !== j) })}
                        style={{ marginTop: 24 }}
                      >
                        <Icon name="x" size={16} />
                      </Button>
                    </div>
                  ))}
                  <div>
                    <Button
                      size="sm"
                      onClick={() => set(i, { slabs: [...t.slabs, { upTo: "", price: "" }] })}
                    >
                      Add band
                    </Button>
                  </div>
                  <div className="grid grid-2">
                    <Field
                      id={`t-every-${i}`}
                      label="Then every (minutes)"
                      hint="Longer stays pay this for each started unit."
                      error={fe?.repeatEvery}
                    >
                      <input
                        suppressHydrationWarning
                        id={`t-every-${i}`}
                        className="input num"
                        inputMode="numeric"
                        value={t.repeatEvery}
                        onChange={(e) => set(i, { repeatEvery: e.target.value })}
                        aria-invalid={!!fe?.repeatEvery}
                      />
                    </Field>
                    <Field id={`t-rprice-${i}`} label="Repeat price" error={fe?.repeatPrice}>
                      <div className="input-group">
                        <span className="prefix">₹</span>
                        <input
                          suppressHydrationWarning
                          id={`t-rprice-${i}`}
                          className="input num has-prefix"
                          inputMode="decimal"
                          value={t.repeatPrice}
                          onChange={(e) => set(i, { repeatPrice: e.target.value })}
                          aria-invalid={!!fe?.repeatPrice}
                        />
                      </div>
                    </Field>
                  </div>
                </>
              ) : (
                <Field
                  id={`t-flat-${i}`}
                  label={t.model === "FLAT" ? "Price per started 24 hours" : "Price per entry"}
                  error={fe?.flat}
                >
                  <div className="input-group" style={{ maxWidth: 220 }}>
                    <span className="prefix">₹</span>
                    <input
                      suppressHydrationWarning
                      id={`t-flat-${i}`}
                      className="input num has-prefix"
                      inputMode="decimal"
                      value={t.flat}
                      onChange={(e) => set(i, { flat: e.target.value })}
                      aria-invalid={!!fe?.flat}
                    />
                  </div>
                </Field>
              )}

              <div className="grid grid-2">
                {t.model !== "PER_ENTRY" && (
                  <Field
                    id={`t-cap-${i}`}
                    label="Day cap (optional)"
                    hint="Most one 24-hour block can cost."
                    error={fe?.dayCap}
                  >
                    <div className="input-group">
                      <span className="prefix">₹</span>
                      <input
                        suppressHydrationWarning
                        id={`t-cap-${i}`}
                        className="input num has-prefix"
                        inputMode="decimal"
                        value={t.dayCap}
                        onChange={(e) => set(i, { dayCap: e.target.value })}
                        aria-invalid={!!fe?.dayCap}
                      />
                    </div>
                  </Field>
                )}
                <Field id={`t-min-${i}`} label="Minimum fare (optional)" error={fe?.minimum}>
                  <div className="input-group">
                    <span className="prefix">₹</span>
                    <input
                      suppressHydrationWarning
                      id={`t-min-${i}`}
                      className="input num has-prefix"
                      inputMode="decimal"
                      value={t.minimum}
                      onChange={(e) => set(i, { minimum: e.target.value })}
                      aria-invalid={!!fe?.minimum}
                    />
                  </div>
                </Field>
              </div>
              {fe?.schema.map((m) => (
                <Issue key={m} tone="bad">
                  {m}
                </Issue>
              ))}
            </div>
          </Card>
        );
      })}
      <div>
        <Button icon="check" onClick={() => onChange([...draft.tariffs, newTariff("Two-wheeler")])}>
          Add another tariff
        </Button>
      </div>
      {analysis.classProblems.map((p) => (
        <Issue key={p} tone="bad">
          {p}
        </Issue>
      ))}
      {analysis.classWarnings.map((p) => (
        <Issue key={p} tone="warn">
          {p}
        </Issue>
      ))}
      <FareTryIt draft={draft} analysis={analysis} />
    </>
  );
}

function FareTryIt({ draft, analysis }: { draft: SetupDraft; analysis: Analysis }) {
  const usable = analysis.tariffs.flatMap((t) => (t.tariff ? [t] : []));
  const [cls, setCls] = useState("");
  const [entry, setEntry] = useState("");
  const [exit, setExit] = useState("");
  const chosen = usable.find((t) => t.vehicleClass === cls) ?? usable[0];
  const day = draft.effectiveFrom || "";
  const entryValue = entry || (day ? `${day}T10:00` : "");
  const exitValue = exit || (day ? `${day}T12:30` : "");

  const result = useMemo(
    () =>
      chosen?.tariff ? tryFare(chosen.tariff, chosen.vehicleClass, entryValue, exitValue) : null,
    [chosen, entryValue, exitValue],
  );

  return (
    <Card
      title="Try a fare"
      subtitle="Uses the same fare engine as the gate app, on the tariff above"
    >
      {!chosen ? (
        <Issue tone="info">
          {draft.effectiveFrom === ""
            ? "Choose the tariff start date (Time rules step) and complete a valid tariff to try a fare."
            : "Complete a valid tariff above to try a fare."}
        </Issue>
      ) : (
        <div className="stack">
          <div className="grid grid-3">
            <Field id="try-class" label="Vehicle class">
              <select
                suppressHydrationWarning
                id="try-class"
                className="select"
                value={chosen.vehicleClass}
                onChange={(e) => setCls(e.target.value)}
              >
                {usable.map((t) => (
                  <option key={t.vehicleClass}>{t.vehicleClass}</option>
                ))}
              </select>
            </Field>
            <Field id="try-in" label="Entry (IST)">
              <input
                suppressHydrationWarning
                id="try-in"
                type="datetime-local"
                className="input"
                value={entryValue}
                onChange={(e) => setEntry(e.target.value)}
              />
            </Field>
            <Field id="try-out" label="Exit (IST)">
              <input
                suppressHydrationWarning
                id="try-out"
                type="datetime-local"
                className="input"
                value={exitValue}
                onChange={(e) => setExit(e.target.value)}
              />
            </Field>
          </div>
          {result?.ok ? (
            <div className="stack-sm" role="status">
              <div className="issue tone-ok">
                <Icon name="checkCircle" size={20} />
                <div>
                  <b style={{ fontSize: 18 }} className="num">
                    {result.fare}
                  </b>{" "}
                  for a stay of {result.stay}
                </div>
              </div>
              <table className="data">
                <thead>
                  <tr>
                    <th>Step</th>
                    <th>Detail</th>
                    <th>Total so far</th>
                  </tr>
                </thead>
                <tbody>
                  {result.steps.map((s) => (
                    <tr key={s.label}>
                      <td>{s.label}</td>
                      <td className="muted">{s.detail ?? "—"}</td>
                      <td className="num">{s.runningTotal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : result ? (
            <Issue tone="bad">{result.message}</Issue>
          ) : null}
          <p className="small muted">
            The night window and grace rules are included. An example only: this does not save
            anything.
          </p>
        </div>
      )}
    </Card>
  );
}
