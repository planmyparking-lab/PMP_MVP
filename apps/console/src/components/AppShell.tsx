"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { selectFacility, signOut } from "../../app/actions";
import type { ConsoleSession } from "../lib/data/types";
import { bindMenuEscape } from "../lib/menuEscape";
import { Icon } from "./ui/Icon";
import type { IconName } from "./ui/Icon";

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** live = reads the database, logic = rules only, off = waiting for backend. */
  state?: "live" | "logic" | "off";
}

const OVERVIEW: NavItem[] = [{ href: "/", label: "Dashboard", icon: "dashboard", state: "live" }];
const OPERATIONS: NavItem[] = [
  { href: "/occupancy", label: "Occupancy", icon: "gauge", state: "live" },
  { href: "/conflicts", label: "Conflicts", icon: "swap", state: "live" },
  { href: "/devices", label: "Devices & staff", icon: "device", state: "live" },
  { href: "/overstay", label: "Overstay", icon: "alert", state: "live" },
  { href: "/shifts", label: "Shifts", icon: "clock", state: "live" },
  { href: "/activity", label: "Activity", icon: "list", state: "live" },
];
const MANAGE: NavItem[] = [
  { href: "/facility", label: "Facility", icon: "building", state: "live" },
  { href: "/setup", label: "Setup", icon: "settings", state: "logic" },
  { href: "/reports", label: "Reports", icon: "file", state: "logic" },
];
const ALL = [...OVERVIEW, ...OPERATIONS, ...MANAGE];

const STATE_LABEL = {
  live: "Reads live data",
  logic: "Rules only, no database yet",
  off: "Waiting for backend",
} as const;

function NavGroup({ label, items, path }: { label?: string; items: NavItem[]; path: string }) {
  return (
    <div className="nav-group">
      {label && <div className="nav-label">{label}</div>}
      {items.map((item) => {
        const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            title={item.state ? STATE_LABEL[item.state] : undefined}
          >
            <Icon name={item.icon} size={18} />
            <span>{item.label}</span>
            {item.state && item.state !== "live" && (
              <span
                className={`nav-pill nav-pill-${item.state}`}
                aria-label={STATE_LABEL[item.state]}
              >
                {item.state === "logic" ? "Rules" : "Soon"}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function ConnectionPill({ session }: { session: ConsoleSession }) {
  const map = {
    offline: { cls: "conn-off", text: "Offline preview", tip: "No Supabase project configured" },
    "signed-out": { cls: "conn-off", text: "Signed out", tip: "Sign in to load data" },
    denied: { cls: "conn-warn", text: "No access", tip: "No readable membership" },
    ok: { cls: "conn-ok", text: "Connected", tip: "Reading Supabase with your session" },
  } as const;
  const m = map[session.kind];
  return (
    <span className={`conn ${m.cls}`} title={m.tip}>
      <span className="conn-dot" />
      <span className="hide-sm">{m.text}</span>
    </span>
  );
}

function FacilitySwitcher({ session }: { session: ConsoleSession }) {
  const formRef = useRef<HTMLFormElement>(null);
  if (session.kind !== "ok") return null;
  if (session.facilities.length === 0) {
    return (
      <span className="facility-chip" title="No facility row is readable for this account yet">
        <Icon name="building" size={15} />
        <span className="hide-sm">No facility</span>
      </span>
    );
  }
  return (
    <form ref={formRef} action={selectFacility} className="facility-switch">
      <Icon name="building" size={15} />
      <label className="sr-only" htmlFor="facility">
        Facility
      </label>
      <select
        id="facility"
        name="facility"
        defaultValue={session.facility?.id}
        onChange={() => formRef.current?.requestSubmit()}
        disabled={session.facilities.length < 2}
      >
        {session.facilities.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </form>
  );
}

function UserMenu({ session }: { session: ConsoleSession }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  // ARIA menu convention: Escape closes the menu and returns focus to its button.
  useEffect(() => {
    if (!open) return;
    return bindMenuEscape(
      document,
      () => setOpen(false),
      () => buttonRef.current?.focus(),
    );
  }, [open]);

  if (session.kind === "offline") return null;
  if (session.kind === "signed-out") {
    return (
      <Link href="/login" className="btn btn-primary btn-sm">
        Sign in
      </Link>
    );
  }
  const initial = session.email.slice(0, 1).toUpperCase();
  return (
    <div className="user-menu" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className="avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
      >
        {initial}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <b>{session.email}</b>
            <span className="small muted">
              {session.kind === "ok"
                ? session.role === "owner"
                  ? "Owner"
                  : "Manager"
                : "No access"}
            </span>
          </div>
          <form action={signOut}>
            <button type="submit" className="menu-item" role="menuitem">
              <Icon name="arrowLeft" size={16} />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children, session }: { children: ReactNode; session: ConsoleSession }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const current = ALL.find((i) => (i.href === "/" ? path === "/" : path.startsWith(i.href)));

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (path === "/login") return <>{children}</>;

  return (
    <div className="shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <aside className="sidebar" data-open={open} aria-label="Primary">
        <Link href="/" className="brand" aria-label="PlanMyParking home">
          {/* Plain img: the mark is a small static PNG with transparency. */}
          <img src="/brand/mark-256.png" alt="" width={36} height={36} className="brand-logo" />
          <span>
            <div className="brand-name">
              PlanMy<span>Parking</span>
            </div>
            <div className="brand-sub">Operator Console</div>
          </span>
        </Link>
        <nav className="nav" aria-label="Main">
          <NavGroup items={OVERVIEW} path={path} />
          <NavGroup label="Operations" items={OPERATIONS} path={path} />
          <NavGroup label="Manage" items={MANAGE} path={path} />
        </nav>
        <div className="sidebar-foot">
          {session.kind === "ok" && session.facility ? (
            <div className="side-facility">
              <span className="small">Current site</span>
              <b>{session.facility.name}</b>
              <span className="small">{session.facility.slotCount} slots</span>
            </div>
          ) : (
            <div className="side-facility">
              <span className="small">
                {session.kind === "offline"
                  ? "Offline preview. Connect Supabase to see live data."
                  : "No facility selected"}
              </span>
            </div>
          )}
        </div>
      </aside>
      <div className="scrim" data-open={open} onClick={() => setOpen(false)} aria-hidden="true" />
      <div className="main-col">
        <div className="topbar">
          <button
            type="button"
            className="btn btn-ghost icon-btn menu-btn"
            aria-label="Open navigation"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name="menu" />
          </button>
          <nav className="crumbs" aria-label="Breadcrumb">
            <span className="hide-sm">Console</span>
            <Icon name="chevron" size={14} />
            <b>{current?.label ?? "Page"}</b>
          </nav>
          <div className="topbar-spacer" />
          <ConnectionPill session={session} />
          <FacilitySwitcher session={session} />
          <UserMenu session={session} />
        </div>
        <main id="content" className="page" tabIndex={-1} key={path}>
          {children}
        </main>
      </div>
    </div>
  );
}
