# Settings Host and Account Truth

**Status:** Approved  
**Date:** 2026-07-15  
**Owner:** Ben  
**GitHub:** #993  
**Builds on:** #255 host diagnostics and #866 Herdr install guidance

## Problem

Advanced host settings report implementation details without consistently telling an admin whether
Jarv1s can operate or what to do next. The page can report Herdr as unusable even when a valid root
tab is configured, offers a terminal-only install path, presents diagnostics without a clear purpose,
and displays log level as though it were an editable setting.

Profile & account repeats the user's email, provides no secure change flow, and lacks a clear visual
hierarchy between personal identity and account management.

## Language

- **Deployment host:** the physical machine running the Jarv1s deployment.
- **Jarv1s runtime:** the container or process environment where Jarv1s executes commands.
- **Session backend:** the tmux or Herdr implementation that hosts Jarv1s chat sessions.
- **Root workspace:** the configured Herdr tab or pane from which Jarv1s creates session panes.
- **Installed:** the Herdr binary is present in the Jarv1s runtime.
- **Usable:** Herdr is installed and Jarv1s can resolve a Root workspace.
- **Sign-in email:** the email identity used by a local-password account. It is distinct from the
  address belonging to an external email Connection.

UI copy must use these meanings and must not call a container-local probe a physical-host inventory.

## Locked Decisions

### 1. Herdr detection and one-click installation

- Settings detects Herdr live in the Jarv1s runtime.
- Installed and Usable are separate states. A missing Root workspace must never be described as a
  missing binary.
- `JARVIS_HERDR_ROOT_TAB`, `JARVIS_HERDR_ROOT_PANE`, and the runtime's `HERDR_PANE_ID` all count as
  valid Root workspace configuration. Resolution and availability must share one rule so they cannot
  disagree.
- When Herdr is not installed, an eligible admin sees an **Install Herdr** action.
- Confirmation shows the exact fixed action (`scripts/install-herdr.sh`). The API executes only that
  repository-owned installer inside the Jarv1s runtime; it accepts no command, URL, path, version, or
  argument from the request.
- The existing pinned artifact, architecture allowlist, SHA-256 verification, fixed persistent tools
  directory, and idempotency guarantees remain mandatory.
- Installation is single-flight, bounded by a timeout, audited, and returns structured state rather
  than unrestricted process output.
- After success, Settings automatically refreshes Herdr status. If no Root workspace is configured,
  it shows the exact deployment guidance needed to configure one; installation does not silently
  choose or create an operator workspace.

### 2. Diagnostics are an on-demand troubleshooting snapshot

Rename the action to **Check system health** and explain when to use it:

- after installation, upgrade, or restart;
- when chat sessions will not start;
- when syncing, scheduled work, or background jobs appear stuck;
- before sharing technical details for support.

Keep the existing safe checks: database connectivity, pg-boss/job-queue availability, and Session
backend availability. Present one derived summary first:

- **Healthy:** every check passes;
- **Needs attention:** no failure, but at least one warning;
- **Action required:** at least one check fails.

Failures and warnings appear before successful checks. Every non-pass result names the likely user
impact and one safe next action. Runtime metadata remains available under collapsed technical details.
Do not add a monitoring dashboard, historical health storage, raw logs, stack traces, secret values,
or arbitrary diagnostic commands.

### 3. Log level is not a setting

Remove the standalone Log level row. The current level may remain read-only inside diagnostic
technical details. This issue does not add runtime log-level mutation, persistence, or restart
coordination.

### 4. Profile hierarchy and one authoritative email surface

- Use a compact identity summary followed by the existing display-name and addressed-as fields.
- Show email once, in Account management, with a **Change email** action when eligible.
- Keep sessions, export, and delete-account actions under Account management. Do not invent new
  profile fields or another account/security dashboard.

### 5. Secure email change for local-password accounts

Email change is available only when all of these are true:

- the signed-in user owns a local password credential;
- the user recently re-authenticated with that password;
- the user has a healthy, send-capable email Connection (Google send or IMAP with SMTP).

The flow is:

1. Re-authenticate and enter a normalized new email.
2. Select the sending Connection only when more than one eligible Connection exists.
3. Send a short-lived, one-time code to the new address through the existing provider-neutral email
   send capability.
4. Keep the current email authoritative until the code is verified.
5. Apply the new email atomically, notify the old address, revoke every other session, and retain the
   current session.

Store only a hash of the verification code with its expiry and attempt count. Rate-limit code issue
and verification, consume a code once, audit success and failure without recording either email body
or code, and never place the code in a job payload or log.

If no send-capable Connection exists, explain that one is required; do not show a control that cannot
complete. This flow is not account recovery. OAuth/OIDC-only accounts remain provider-managed and do
not get an in-app email-change action in this slice.

## Security and Ownership Boundaries

- Both implementation slices are security-tier: one mutates executable runtime state and the other
  changes authentication identity.
- Host install remains admin-only and fixed-command-only. Never add a generic shell/command route or
  mount the Docker socket for this feature.
- Email change is self-service only. Admin status grants no ability to change another user's email or
  bypass re-authentication.
- Auth secrets stay in the auth runtime boundary. Settings receives only the minimum credential and
  result booleans it needs.
- Use the email module's declared public capability for sending; Settings/Auth must not import module
  internals or query connector tables directly.
- Preserve DataContextDb, AccessContext, RLS, secret-handling, and metadata-only job-payload
  invariants.

## Delivery Slices

Implement as two serialized PRs under #993:

1. **Host truth:** shared Root workspace detection, one-click Herdr install, system-health summary,
   recovery guidance, and removal of the standalone Log level row.
2. **Account truth:** compact profile hierarchy and the secure local-password email-change flow.

The host PR lands first. The account PR receives independent security review and must not broaden into
password reset, account recovery, OAuth identity relinking, or instance-wide transactional email.

## Verification

### Host truth

- Integration: non-admin install and diagnostics requests are rejected.
- Unit: Root workspace detection treats configured tab, configured pane, and runtime pane as usable.
- Unit: the installer endpoint cannot accept or construct request-controlled commands or arguments.
- Integration: concurrent install requests run one installer; timeout/failure is structured and
  audited; successful install triggers a fresh status result.
- Live UAT: from a deployment without Herdr, an admin installs it with one click, sees Installed, and
  receives Root workspace guidance or a Usable result.
- Live UAT: system health clearly explains a deliberately unavailable dependency and its next action.

### Account truth

- Integration: OAuth-only, stale-auth, duplicate-email, missing-Connection, expired-code,
  wrong-code, replay, and rate-limit paths fail safely.
- Integration: the email remains unchanged before verification and changes atomically afterward.
- Integration: verification uses only the selected user's send-capable Connection and never exposes
  its credential.
- Integration: success retains the current session, revokes other sessions, and writes a safe audit
  event.
- Live UAT: a local-password user with a healthy Connection changes email, verifies the code received
  at the new address, and signs in with the new email.
- UI: email appears once; ineligible states explain ownership or the missing prerequisite; profile
  hierarchy follows existing settings spacing and component patterns.

Both PRs must pass `pnpm verify:foundation`, independent security QA, and the live-path gate before
merge.

## Non-Goals

- Generic remote command execution or arbitrary installer inputs.
- Automatic Root workspace selection.
- Host monitoring, health history, log viewing, or live log-level changes.
- Password reset, account recovery, 2FA, OAuth identity relinking, or OAuth-email mutation.
- Instance-wide SMTP or transactional-email infrastructure.
