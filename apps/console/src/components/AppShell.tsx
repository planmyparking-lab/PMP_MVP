"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./ui/Icon";
import type { IconName } from "./ui/Icon";
import { Tip } from "./ui/primitives";

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** ok = connected, warn = logic only, off = not built. Drives the small dot beside the label. */
  dot?: "ok" | "warn" | "off";
}

const OVERVIEW: NavItem[] = [{ href: "/", label: "Dashboard", icon: "dashboard" }];
const OPERATIONS: NavItem[] = [
  { href: "/occupancy", label: "Occupancy", icon: "gauge", dot: "warn" },
  { href: "/shifts", label: "Shifts", icon: "clock", dot: "off" },
  { href: "/conflicts", label: "Conflicts", icon: "swap", dot: "off" },
  { href: "/devices", label: "Devices", icon: "device", dot: "warn" },
];
const MANAGE: NavItem[] = [
  { href: "/setup", label: "Setup", icon: "settings", dot: "warn" },
  { href: "/reports", label: "Reports", icon: "file", dot: "warn" },
];
const ALL = [...OVERVIEW, ...OPERATIONS, ...MANAGE];

function NavGroup({
  label,
  items,
  path,
  onNavigate,
}: {
  label?: string;
  items: NavItem[];
  path: string;
  onNavigate: () => void;
}) {
  return (
    <div>
      {label && <div className="nav-label">{label}</div>}
      {items.map((item) => {
        const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon name={item.icon} size={18} />
            <span>{item.label}</span>
            {item.dot && (
              <span
                className={`status-dot tone-${item.dot}`}
                role="img"
                aria-label={item.dot === "warn" ? "Partly built" : "Not built yet"}
              />
            )}
          </Link>
        );
      })}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const current = ALL.find((i) => (i.href === "/" ? path === "/" : path.startsWith(i.href)));

  // Close the drawer on navigation and with Escape.
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <aside className="sidebar" data-open={open} aria-label="Primary">
        <Link href="/" className="brand" aria-label="PlanMyParking home">
          <span className="brand-mark" aria-hidden="true">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fff"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 21V4h5.5a4.5 4.5 0 0 1 0 9H8" />
            </svg>
          </span>
          <span>
            <div className="brand-name">PlanMyParking</div>
            <div className="brand-sub">Operator Console</div>
          </span>
        </Link>
        <nav className="nav" aria-label="Main">
          <NavGroup items={OVERVIEW} path={path} onNavigate={() => setOpen(false)} />
          <NavGroup
            label="Operations"
            items={OPERATIONS}
            path={path}
            onNavigate={() => setOpen(false)}
          />
          <NavGroup label="Manage" items={MANAGE} path={path} onNavigate={() => setOpen(false)} />
        </nav>
        <div className="sidebar-foot">
          <div>Development build</div>
          <div>
            <span className="status-dot tone-warn" /> Dot = partly built
          </div>
          <div>
            <span className="status-dot tone-off" /> Dot = not built yet
          </div>
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
            <span className="hide-sm">PlanMyParking</span>
            <Icon name="chevron" size={14} />
            <b>{current?.label ?? "Page"}</b>
          </nav>
          <div className="topbar-spacer" />
          <Tip text="Facilities appear here once the database and sign-in are connected.">
            <span
              className="btn btn-secondary btn-sm"
              tabIndex={0}
              aria-disabled="true"
              style={{ opacity: 0.75, cursor: "not-allowed" }}
            >
              <Icon name="building" size={15} />
              <span className="hide-sm">No facility connected</span>
            </span>
          </Tip>
        </div>
        <main id="content" className="page" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
