"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export type Tone = "ok" | "warn" | "bad" | "info" | "off";

export const TONE_LABEL: Record<Tone, string> = {
  ok: "Healthy",
  warn: "Warning",
  bad: "Critical",
  info: "Pending",
  off: "Disconnected",
};

export function StatusBadge({ tone, children }: { tone: Tone; children?: ReactNode }) {
  return <span className={`badge tone-${tone}`}>{children ?? TONE_LABEL[tone]}</span>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  icon?: IconName;
};

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  children,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`btn btn-${variant}${size === "sm" ? " btn-sm" : ""}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 15 : 17} />}
      {children}
    </button>
  );
}

/** Wraps a control with a hover/focus tooltip. Used to explain why an action is unavailable. */
export function Tip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="tip">
      {children}
      <span className="tip-text" role="tooltip">
        {text}
      </span>
    </span>
  );
}

/** A button that is visibly unavailable and says why. It stays focusable so keyboard users get the reason. */
export function UnavailableButton({
  reason,
  children,
  icon,
  variant = "secondary",
}: {
  reason: string;
  children: ReactNode;
  icon?: IconName;
  variant?: ButtonProps["variant"];
}) {
  return (
    <Tip text={reason}>
      <Button
        variant={variant}
        icon={icon}
        aria-disabled="true"
        aria-label={`${children}. Unavailable: ${reason}`}
      >
        {children}
      </Button>
    </Tip>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

export function Banner({
  tone,
  icon = "info",
  title,
  children,
  demo,
}: {
  tone: Tone;
  icon?: IconName;
  title: string;
  children?: ReactNode;
  demo?: boolean;
}) {
  return (
    <div
      className={`banner ${demo ? "demo-banner" : `tone-${tone}`}`}
      role={demo ? "status" : undefined}
    >
      <Icon name={icon} />
      <div>
        <b>{title}</b>
        {children}
      </div>
    </div>
  );
}

export function Card({
  title,
  subtitle,
  action,
  children,
  flush,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="card">
      {title && (
        <div className="card-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={flush ? undefined : "card-body"}>{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  icon,
  value,
  foot,
  tone,
  badge,
}: {
  label: string;
  icon: IconName;
  /** Undefined means the number is not available: a dash and an explanation are shown instead. */
  value?: string;
  foot: string;
  tone?: Tone;
  badge?: string;
}) {
  return (
    <div className="card stat">
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">
          <Icon name={icon} size={17} />
        </span>
      </div>
      <div className={`stat-value num${value === undefined ? " unavailable" : ""}`}>
        {value ?? "—"}
      </div>
      {badge && tone && <StatusBadge tone={tone}>{badge}</StatusBadge>}
      <div className="stat-foot">{foot}</div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  needs,
  action,
}: {
  icon: IconName;
  title: string;
  children: ReactNode;
  needs?: readonly string[];
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={24} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {needs && (
        <ul>
          {needs.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {action}
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  ok,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  ok?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <span className="field-error" id={`${id}-msg`} role="alert">
          <Icon name="alert" size={14} />
          {error}
        </span>
      ) : ok ? (
        <span className="field-ok" id={`${id}-msg`}>
          {ok}
        </span>
      ) : hint ? (
        <span className="hint" id={`${id}-msg`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function Skeleton({
  width = "100%",
  height = 14,
}: {
  width?: string | number;
  height?: number;
}) {
  return <div className="skeleton" style={{ width, height }} aria-hidden="true" />;
}

export function Issue({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div className={`issue tone-${tone}`} role={tone === "bad" ? "alert" : undefined}>
      <Icon name={tone === "ok" ? "checkCircle" : "alert"} size={17} />
      <div>{children}</div>
    </div>
  );
}
