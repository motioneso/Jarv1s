import "../styles/settings.css";
import "../styles/settings-panes.css";
import "../styles/settings-panes-2.css";
import "../styles/settings-panes-3.css";

import {
  Activity,
  Boxes,
  Brain,
  Command,
  Database,
  Fingerprint,
  Link2,
  ListChecks,
  Package,
  Palette,
  ScrollText,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  GitCommitHorizontal,
  UserRound,
  Users,
  type LucideIcon
} from "lucide-react";
import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { FeedbackProvider } from "./settings-feedback";
import { ProfilePane } from "./settings-personal-panes";
import { coerceSettingsSectionId } from "./settings-navigation";
import {
  browserSettingsStorage,
  readSettingsStorage,
  writeSettingsStorage
} from "./settings-storage";
import type { PaneProps } from "./settings-types";
import { PrioritySettings, Segmented } from "./settings-ui";
import type { MeResponse } from "@jarv1s/shared";

type SettingsPane = ComponentType<PaneProps>;

interface SettingsSection<Id extends string> {
  readonly id: Id;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly Pane: SettingsPane;
}

type PersonalSectionId =
  | "profile"
  | "assistant"
  | "priorities"
  | "memory"
  | "connected"
  | "sources"
  | "modules"
  | "appearance"
  | "general"
  | "activity"
  | "skills";

type AdminSectionId =
  | "people"
  | "identity"
  | "aiproviders"
  | "instmods"
  | "audit"
  | "oversight"
  | "host";

function lazyPane(loader: () => Promise<{ default: SettingsPane }>) {
  return lazy(loader);
}

const AssistantPane = lazyPane(() =>
  import("./settings-ai-pane").then((module) => ({ default: module.AssistantPane }))
);
const MemoryPane = lazyPane(() =>
  import("./settings-memory-pane").then((module) => ({ default: module.MemoryPane }))
);
const ConnectedPane = lazyPane(() =>
  import("./settings-personal-data-panes").then((module) => ({ default: module.ConnectedPane }))
);
const SourcesPane = lazyPane(() =>
  import("./settings-personal-data-panes").then((module) => ({ default: module.SourcesPane }))
);
const ModulesPane = lazyPane(() =>
  import("./settings-personal-data-panes").then((module) => ({ default: module.ModulesPane }))
);
const GeneralPane = lazyPane(() =>
  import("./settings-personal-data-panes").then((module) => ({ default: module.GeneralPane }))
);
const AppearancePane = lazyPane(() =>
  import("./settings-appearance-pane").then((module) => ({ default: module.AppearancePane }))
);
const ActivityPane = lazyPane(() =>
  import("./settings-activity-pane").then((module) => ({ default: module.ActivityPane }))
);
const SkillsPane = lazyPane(() =>
  import("./settings-skills-pane").then((module) => ({ default: module.SettingsSkillsPane }))
);

function PrioritiesPane(_props: PaneProps) {
  return <PrioritySettings />;
}

const PeoplePane = lazyPane(() =>
  import("./settings-admin-panes").then((module) => ({ default: module.PeoplePane }))
);
const AiProvidersPane = lazyPane(() =>
  import("./settings-ai-admin-pane").then((module) => ({ default: module.AiProvidersPane }))
);
const IdentityPane = lazyPane(() =>
  import("./settings-admin-panes").then((module) => ({ default: module.IdentityPane }))
);
const InstanceModulesPane = lazyPane(() =>
  import("./settings-admin-panes").then((module) => ({ default: module.InstanceModulesPane }))
);
const AuditPane = lazyPane(() =>
  import("./settings-audit-pane").then((module) => ({ default: module.AuditPane }))
);
const OversightPane = lazyPane(() =>
  import("./settings-admin-panes").then((module) => ({ default: module.OversightPane }))
);
const HostPane = lazyPane(() =>
  import("./settings-admin-panes").then((module) => ({ default: module.HostPane }))
);

const PERSONAL_SECTIONS = [
  { id: "profile", icon: UserRound, label: "Profile & account", Pane: ProfilePane },
  { id: "assistant", icon: GitCommitHorizontal, label: "Assistant & AI", Pane: AssistantPane },
  { id: "priorities", icon: ListChecks, label: "Priorities", Pane: PrioritiesPane },
  { id: "memory", icon: Brain, label: "Memory & context", Pane: MemoryPane },
  { id: "connected", icon: Link2, label: "Connected accounts", Pane: ConnectedPane },
  { id: "sources", icon: Database, label: "Data sources", Pane: SourcesPane },
  { id: "modules", icon: Boxes, label: "Modules", Pane: ModulesPane },
  { id: "skills", icon: Command, label: "Skills", Pane: SkillsPane },
  { id: "appearance", icon: Palette, label: "Appearance", Pane: AppearancePane },
  { id: "activity", icon: Activity, label: "Activity", Pane: ActivityPane },
  { id: "general", icon: SlidersHorizontal, label: "General", Pane: GeneralPane }
] as const satisfies readonly SettingsSection<PersonalSectionId>[];

const ADMIN_SECTIONS = [
  { id: "people", icon: Users, label: "People & access", Pane: PeoplePane },
  { id: "identity", icon: Fingerprint, label: "Identity & registration", Pane: IdentityPane },
  { id: "aiproviders", icon: GitCommitHorizontal, label: "Assistant & AI", Pane: AiProvidersPane },
  { id: "instmods", icon: Package, label: "Instance modules", Pane: InstanceModulesPane },
  { id: "audit", icon: ScrollText, label: "Audit & operations", Pane: AuditPane },
  { id: "oversight", icon: Activity, label: "Connector oversight", Pane: OversightPane },
  { id: "host", icon: ServerCog, label: "Advanced host setup", Pane: HostPane }
] as const satisfies readonly SettingsSection<AdminSectionId>[];

interface SettingsPageProps {
  readonly me: MeResponse;
}

export function SettingsPage({ me }: SettingsPageProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = me.user.isInstanceAdmin;
  const storage = browserSettingsStorage();

  const [mode, setMode] = useState<"personal" | "admin">(() =>
    isAdmin && readSettingsStorage(storage, "mode") === "admin" ? "admin" : "personal"
  );
  const [categoryPersonal, setCategoryPersonal] = useState<PersonalSectionId>(() =>
    coerceSettingsSectionId(PERSONAL_SECTIONS, readSettingsStorage(storage, "categoryPersonal"))
  );
  const [categoryAdmin, setCategoryAdmin] = useState<AdminSectionId>(() =>
    coerceSettingsSectionId(ADMIN_SECTIONS, readSettingsStorage(storage, "categoryAdmin"))
  );

  useEffect(() => writeSettingsStorage(storage, "mode", mode), [mode, storage]);
  useEffect(
    () => writeSettingsStorage(storage, "categoryPersonal", categoryPersonal),
    [categoryPersonal, storage]
  );
  useEffect(
    () => writeSettingsStorage(storage, "categoryAdmin", categoryAdmin),
    [categoryAdmin, storage]
  );

  // #369: honor a `?section=` deep link (e.g. /settings?section=assistant from the empty-chat
  // explainer) so the link lands on the right pane instead of the default Profile. Applied once,
  // then the param is cleared so it does not pin the pane on later manual navigation.
  useEffect(() => {
    const requested = searchParams.get("section");
    if (!requested) return;
    if (PERSONAL_SECTIONS.some((section) => section.id === requested)) {
      setCategoryPersonal(requested as PersonalSectionId);
    } else if (isAdmin && ADMIN_SECTIONS.some((section) => section.id === requested)) {
      setMode("admin");
      setCategoryAdmin(requested as AdminSectionId);
    }
    const next = new URLSearchParams(searchParams);
    next.delete("section");
    setSearchParams(next, { replace: true });
  }, [searchParams, isAdmin, setSearchParams]);

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
            <Suspense fallback={<div className="pane__loading">Loading settings...</div>}>
              <Pane
                me={me}
                onNavigate={(path) => navigate(path)}
                onSelectSection={(id) => setActiveSection(id as PersonalSectionId | AdminSectionId)}
              />
            </Suspense>
          </div>
        </div>
      </div>
    </FeedbackProvider>
  );
}
