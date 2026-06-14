import "../styles/settings.css";
import "../styles/settings-panes.css";

import {
  Activity,
  Boxes,
  Brain,
  Database,
  Fingerprint,
  Link2,
  Package,
  ScrollText,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  Users,
  type LucideIcon
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { FeedbackProvider } from "./settings-feedback";
import { ADMIN_PANES } from "./settings-admin-panes";
import { PERSONAL_PANES } from "./settings-personal-panes";
import { Segmented, Switch } from "./settings-ui";
import type { MeResponse } from "@jarv1s/shared";

interface NavItem {
  readonly id: string;
  readonly icon: LucideIcon;
  readonly label: string;
}

const PERSONAL_NAV: readonly NavItem[] = [
  { id: "profile", icon: UserRound, label: "Profile & account" },
  { id: "assistant", icon: Sparkles, label: "Assistant & AI" },
  { id: "memory", icon: Brain, label: "Memory & context" },
  { id: "connected", icon: Link2, label: "Connected accounts" },
  { id: "sources", icon: Database, label: "Data sources" },
  { id: "modules", icon: Boxes, label: "Modules" },
  { id: "general", icon: SlidersHorizontal, label: "General" }
];

const ADMIN_NAV: readonly NavItem[] = [
  { id: "people", icon: Users, label: "People & access" },
  { id: "identity", icon: Fingerprint, label: "Identity & registration" },
  { id: "instmods", icon: Package, label: "Instance modules" },
  { id: "audit", icon: ScrollText, label: "Audit & operations" },
  { id: "oversight", icon: Activity, label: "Connector oversight" },
  { id: "host", icon: ServerCog, label: "Advanced host setup" }
];

const STORAGE = {
  mode: "jarvis.set.mode",
  advanced: "jarvis.set.adv",
  categoryPersonal: "jarvis.set.catP",
  categoryAdmin: "jarvis.set.catA"
} as const;

interface SettingsPageProps {
  readonly me: MeResponse;
}

export function SettingsPage({ me }: SettingsPageProps) {
  const navigate = useNavigate();
  const isAdmin = me.user.isInstanceAdmin;

  const [mode, setMode] = useState<string>(() => localStorage.getItem(STORAGE.mode) ?? "personal");
  const [advanced, setAdvanced] = useState<boolean>(
    () => localStorage.getItem(STORAGE.advanced) === "1"
  );
  const [categoryPersonal, setCategoryPersonal] = useState<string>(
    () => localStorage.getItem(STORAGE.categoryPersonal) ?? "profile"
  );
  const [categoryAdmin, setCategoryAdmin] = useState<string>(
    () => localStorage.getItem(STORAGE.categoryAdmin) ?? "people"
  );

  useEffect(() => localStorage.setItem(STORAGE.mode, mode), [mode]);
  useEffect(() => localStorage.setItem(STORAGE.advanced, advanced ? "1" : "0"), [advanced]);
  useEffect(
    () => localStorage.setItem(STORAGE.categoryPersonal, categoryPersonal),
    [categoryPersonal]
  );
  useEffect(() => localStorage.setItem(STORAGE.categoryAdmin, categoryAdmin), [categoryAdmin]);

  const adminMode = isAdmin && mode === "admin";
  const nav = adminMode ? ADMIN_NAV : PERSONAL_NAV;
  const active = adminMode ? categoryAdmin : categoryPersonal;
  const setActive = adminMode ? setCategoryAdmin : setCategoryPersonal;
  const panes = adminMode ? ADMIN_PANES : PERSONAL_PANES;
  const Pane = panes[active] ?? panes[nav[0]!.id]!;

  return (
    <FeedbackProvider>
      <div className="set2">
        <div className="set2__bar">
          {isAdmin ? (
            <Segmented
              value={mode === "admin" ? "admin" : "personal"}
              options={[
                { value: "personal", label: "Personal" },
                { value: "admin", label: "Admin / Setup" }
              ]}
              ariaLabel="Settings mode"
              onChange={(value) => setMode(value)}
            />
          ) : (
            <span />
          )}
          <label className="set2__adv">
            <span className="set2__adv-tx">
              <span className="set2__adv-t">Advanced</span>
              <span className="set2__adv-d">Show provider, host &amp; developer detail</span>
            </span>
            <Switch ariaLabel="Advanced settings" checked={advanced} onChange={setAdvanced} />
          </label>
        </div>

        <div className="set2__grid">
          <nav className="set2__nav" aria-label="Settings categories">
            <div className="set2__navgroup">
              {adminMode ? "Admin / Setup" : "Personal settings"}
            </div>
            {nav.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`set2__navitem${active === item.id ? " is-active" : ""}`}
                  aria-current={active === item.id}
                  onClick={() => setActive(item.id)}
                >
                  <span className="ic">
                    <Icon size={17} aria-hidden="true" />
                  </span>
                  <span className="lbl">{item.label}</span>
                </button>
              );
            })}
            {adminMode ? (
              <div className="set2__navnote">
                <ShieldCheck size={13} aria-hidden="true" /> You have owner access
              </div>
            ) : null}
          </nav>

          <div className="set2__pane">
            <Pane advanced={advanced} me={me} onNavigate={(path) => navigate(path)} />
          </div>
        </div>
      </div>
    </FeedbackProvider>
  );
}
