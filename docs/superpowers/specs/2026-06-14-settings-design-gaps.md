# Settings — areas that need a design

For the designer. Found while building the settings hub from the handoff
(`feat/settings-design-page`). Each entry says **what the area is** and, where there's a process
behind it, **the workflow** the design needs to cover.

**Legend**

- **No mark** = the capability already exists in the backend; the settings just don't show it yet, or
  show a thinner version than reality. These mainly need a **design surface**.
- **`*`** = **capability gap — does not exist yet.** Needs a spec, then build, _and_ a design. These
  are logged as design follow-up issues so we can track / spec / build them.

In the shipped UI these all render as faithful rows with a **Coming soon** badge (or a describe-only
toast), so nothing looks broken — they're visual placeholders for the work below.

---

## 1. Surfaces the settings should show but don't (capability EXISTS)

### 1.1 Assistant & AI — provider & model management

**What:** The backend supports multiple AI providers, and **multiple configured models per
provider**, each with capabilities (chat / tool-use / json / vision / summarization), a tier
(reasoning / interactive / economy), and a **capability router** (which model serves which
capability). The settings pane now exposes provider/model/routing management, but credential editing
still needs a designed, non-raw-JSON flow.

**Workflow to design:** edit provider credentials safely → validate/test the provider → preserve the
existing provider/model/capability routing controls without exposing raw secret JSON.

### 1.2 Connected accounts — connecting a new account (Google OAuth)

**What:** Connecting Google **does work today**, but only through a **manual developer flow**: you
create your _own_ Google Cloud project, enable Gmail + Calendar APIs, create a "Desktop app" OAuth
client, paste the **client ID + secret** into the app, open the consent screen, then copy the
`localhost:1` redirect URL back to finish a real token exchange. It's real OAuth, but it's a
build-your-own-app flow — not something a normal user would do. The new design's "Connect account"
button currently only _describes_ the action.

**Workflow to design:**

- **As-is (works now):** the multi-step developer paste-in flow above — needs a proper designed
  surface if we keep it (it's the old `connect-google-panel`, currently unsurfaced).
- **`*` Productized connect (does not exist):** a one-click "Connect Google" using a pre-registered
  app + hosted callback → consent → scope grant, with no client ID/secret typing. This needs app
  registration + a real OAuth callback endpoint before it can be designed as "click → approve →
  done." Decide which experience we're designing for.

### 1.3 Audit & operations — activity log

**What:** There's a real admin audit-events endpoint (`AdminAuditEventDto`: actor / action /
targetType / targetId / metadata / timestamp). The design's audit pane is currently all Coming soon.

**Workflow to design:** render the real event shape as the design's who / what / when list (the
design's bolded-entity phrasing needs a mapping from `action` + `targetType` + `metadata`). Filtering
and CSV export are the natural extensions. (Backups / instance-export below are separate gaps.)

---

## 2. Capability gaps\* — do not exist yet (spec → build → design)

### 2.1 Assistant persona & dials\*

**What:** Persona name, the free-text persona description, and the Tone / Directness / Humor /
Recovery dials. Today they're **local-only** — they don't persist and don't feed anything.
**Highest-value gap:** this is the core "tune how Jarvis sounds" promise.
**Workflow:** edit persona text + dials → persist per user → feed into the assistant's system prompt
so replies + the briefing actually change. Needs a persona/assistant-config model.

### 2.2 Data sources — per-source behaviour permissions\*

**What:** The whole pane of Calendar/Email switches (include-in-briefings, use-for-planning,
detect-commitments, write-back, capture-tasks, thread-summaries, send-on-my-behalf). No backend.
**Workflow:** per source, per behaviour → toggle what Jarvis may do → enforced wherever that
behaviour runs (briefing builder, commitment detector, send path). Needs a per-source permission
model + default-state decision per behaviour.

### 2.3 Notes / vault folder\*

**What:** Point Jarvis at a folder of notes. The design shows an OS folder picker.
**Workflow:** in a server/LAN-served app there is no OS picker — the design needs a way to choose a
**server-side path** (typed path, server-side browse, or upload), then link / unlink, with read-only
guarantees surfaced.

### 2.4 Memory — knowledge browser + inferred/corrections\*

**What:** The design shows three counts (facts / **inferred patterns** / **corrections**) and a
deep-link to a **"Knowledge" screen**. Reality: only flat **facts** exist (no inferred/correction
distinction), and there is **no Knowledge route** — it was folded into Settings.
**Workflow:** browse what Jarvis knows → see provenance (said vs inferred) → confirm / reject / edit /
delete, with inferred patterns decaying over time. Either design this browser _inside_ settings, or
trim the design to facts-only.

### 2.5 General — locale & quiet hours\*

**What:** Time zone, language/region, date format, and quiet-hours (enable + window). No persistence.
**Workflow:** set → persist (user and/or instance) → applied app-wide; quiet hours must be designed
against the Notifications module (notification sensitivity lives in that module) so they don't fight.

### 2.6 Profile — account actions\*

**What:** Active sessions, Export my data, Security (password / 2FA), Delete account — all shown as
rows, no flows.
**Workflow (each needs designing):** sessions = list devices + revoke; export = kick off an export
job + download when ready; security = change password / enrol 2FA (auth-provider dependent); delete =
destructive confirm → wipe account + data. Several depend on the auth provider in use.

### 2.7 People & access — invite + revoke sessions\*

**What:** The design has an **Invite** dialog (email + role). Reality is an **open/approval-based**
registration queue — there is no invite concept. A per-member **"Revoke sessions"** action has a
backend endpoint but no designed UX (currently omitted from the member menu).
**Workflow:** decide invite vs approval (if invites: send email → recipient signs up pre-approved
with a role; if not, the "Invite" button should become registration settings or be dropped).
Revoke-sessions = confirm → sign the member out everywhere.

### 2.8 Identity — sign-in method enable\*

**What:** The design shows a Switch per sign-in method. The backend only exposes **read-only**
enabled/disabled status (methods are configured by the operator via env). Shipped as read-only status
badges.
**Workflow:** if we want in-app control, design a per-method enable flow (and where the client
IDs/secrets/callbacks come from); otherwise keep read-only and the design should reflect that.

### 2.9 Advanced host setup — diagnostics & restart\*

**What:** Multiplexer + tmux/herdr availability are real (read-only, shipped). "Verbose logging",
"Restart server", "Run diagnostics", and "Restart-required settings" have no backend.
**Workflow:** decide whether these even belong in the web UI vs operator tooling; if in-UI, each
needs a designed action (toggle logging, confirm-then-restart with reconnect, run + show diagnostic
results).

---

## 3. Minor clarifications (no new capability)

- **Module toggle scope overlap.** Personal "Modules" and Admin "Instance modules" both toggle
  modules at different scopes. The design should clarify the interaction — a module disabled
  instance-wide should render **locked** (not a live toggle) in the personal pane.
- **Connected-account identity/sync line.** The design shows each account's email identity and
  "Synced X ago"; the real connector record has neither. Either drop those lines or `*`add the fields.
- **"Open settings →" for hidden-nav modules.** Modules with no nav screen (briefings, knowledge,
  notifications, chat) have nowhere to deep-link (they show "Enable to set up" / "No settings"). The
  design assumed every module has its own screen — needs per-module settings sub-views (a larger
  effort) or a defined fallback.

---

**Code ownership update:** the new settings panes now own the AI provider/model/routing surfaces,
Google connect handoff, admin user actions, audit list, and host multiplexer control. The old
settings-only panels were removed; `connect-google-panel` remains because onboarding still embeds
that flow.
