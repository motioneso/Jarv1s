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
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { FeedbackProvider } from "./settings-feedback";
import {
  AuditPane,
  HostPane,
  IdentityPane,
  InstanceModulesPane,
  OversightPane,
  PeoplePane
} from "./settings-admin-panes";
import {
  AssistantPane,
  ConnectedPane,
  GeneralPane,
  MemoryPane,
  ModulesPane,
  ProfilePane,
  SourcesPane
} from "./settings-personal-panes";
import { coerceSettingsSectionId } from "./settings-navigation";
import { Segmented, Switch } from "./settings-ui";
import type { MeResponse } from "@jarv1s/shared";

interface SettingsSection<Id extends string> {
  readonly id: Id;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly Pane: (props: {
    readonly advanced: boolean;
    readonly me: MeResponse;
    readonly onNavigate: (path: string) => void;
  }) => ReactNode;
}

type PersonalSectionId =
  | "profile"
  | "assistant"
  | "memory"
  | "connected"
  | "sources"
  | "modules"
  | "general";

type AdminSectionId = "people" | "identity" | "instmods" | "audit" | "oversight" | "host";

const PERSONAL_SECTIONS = [
  { id: "profile", icon: UserRound, label: "Profile & account", Pane: ProfilePane },
  { id: "assistant", icon: Sparkles, label: "Assistant & AI", Pane: AssistantPane },
  { id: "memory", icon: Brain, label: "Memory & context", Pane: MemoryPane },
  { id: "connected", icon: Link2, label: "Connected accounts", Pane: ConnectedPane },
  { id: "sources", icon: Database, label: "Data sources", Pane: SourcesPane },
  { id: "modules", icon: Boxes, label: "Modules", Pane: ModulesPane },
  { id: "general", icon: SlidersHorizontal, label: "General", Pane: GeneralPane }
] as const satisfies readonly SettingsSection<PersonalSectionId>[];

const ADMIN_SECTIONS = [
  { id: "people", icon: Users, label: "People & access", Pane: PeoplePane },
  { id: "identity", icon: Fingerprint, label: "Identity & registration", Pane: IdentityPane },
  { id: "instmods", icon: Package, label: "Instance modules", Pane: InstanceModulesPane },
  { id: "audit", icon: ScrollText, label: "Audit & operations", Pane: AuditPane },
  { id: "oversight", icon: Activity, label: "Connector oversight", Pane: OversightPane },
  { id: "host", icon: ServerCog, label: "Advanced host setup", Pane: HostPane }
] as const satisfies readonly SettingsSection<AdminSectionId>[];

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

  const [mode, setMode] = useState<"personal" | "admin">(() =>
    isAdmin && localStorage.getItem(STORAGE.mode) === "admin" ? "admin" : "personal"
  );
  const [advanced, setAdvanced] = useState<boolean>(
    () => localStorage.getItem(STORAGE.advanced) === "1"
  );
  const [categoryPersonal, setCategoryPersonal] = useState<PersonalSectionId>(() =>
    coerceSettingsSectionId(PERSONAL_SECTIONS, localStorage.getItem(STORAGE.categoryPersonal))
  );
  const [categoryAdmin, setCategoryAdmin] = useState<AdminSectionId>(() =>
    coerceSettingsSectionId(ADMIN_SECTIONS, localStorage.getItem(STORAGE.categoryAdmin))
  );

  useEffect(() => localStorage.setItem(STORAGE.mode, mode), [mode]);
  useEffect(() => localStorage.setItem(STORAGE.advanced, advanced ? "1" : "0"), [advanced]);
  useEffect(
    () => localStorage.setItem(STORAGE.categoryPersonal, categoryPersonal),
    [categoryPersonal]
  );
  useEffect(() => localStorage.setItem(STORAGE.categoryAdmin, categoryAdmin), [categoryAdmin]);

  const adminMode = isAdmin && mode === "admin";
  const sections = adminMode ? ADMIN_SECTIONS : PERSONAL_SECTIONS;
  const active = adminMode ? categoryAdmin : categoryPersonal;
  const activeSection = sections.find((section) => section.id === active) ?? sections[0]!;
  const Pane = activeSection.Pane;

  const setActiveSection = (id: PersonalSectionId | AdminSectionId) => {
    if (adminMode) {
      setCategoryAdmin(coerceSettingsSectionId(ADMIN_SECTIONS, id));
    } else {
      setCategoryPersonal(coerceSettingsSectionId(PERSONAL_SECTIONS, id));
    }
  };

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
            {sections.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`set2__navitem${active === item.id ? " is-active" : ""}`}
                  aria-current={active === item.id}
                  onClick={() => setActiveSection(item.id)}
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
