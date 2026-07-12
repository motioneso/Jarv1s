# External module review checklist

Use this before placing a local external module under `~/Jarv1s`'s configured modules directory.
External modules run in trusted-operator mode; Jarv1s does not provide marketplace review or a full
runtime sandbox in v1.

## Identity

- Module id, publisher, version, and source repository are clear.
- `jarvis.module.json` matches the package being installed.
- Package lockfile is present if dependencies are bundled or installed.
- Tool names, permission ids, auth ids, and KV namespaces are prefixed with the module id.
- The package is a local directory you reviewed before placing under `JARVIS_MODULES_DIR`.

## Code

- Backend handler entrypoint is small enough to inspect.
- `dist/worker.js` is self-contained; Jarv1s will not run `npm install` for it.
- No unexpected shell execution, process spawning, or dynamic code loading.
- Filesystem reads are limited to module-owned paths or clearly documented operator paths.
- Persistent writes go through Jarv1s KV or credential storage, not ad hoc files in the package
  directory.
- Outbound network calls are expected for the module's purpose.
- Expected outbound hosts are documented in the manifest or README, even though v1 does not enforce
  a host allowlist.
- Dependencies are necessary and not obviously abandoned or suspicious.

## Credentials

- Credential declarations match the external services the module actually uses.
- Instance-scoped credentials are appropriate only for shared/admin-managed keys.
- User-scoped credentials are used for personal accounts.
- Code does not log credentials, include them in thrown errors, write them to KV, or send them to
  the frontend.

## UI

- Web/settings UI matches the module's declared purpose.
- Web UI is prebuilt under `dist/web` and does not require rebuilding Jarv1s.
- UI does not ask for secrets outside Jarv1s credential fields.
- UI does not hide destructive actions behind misleading labels.

## Assistant Tools

- Tool names, descriptions, and input schemas are specific.
- `risk: "read"`, `"write"`, and `"destructive"` match real behavior.
- Write/destructive tools have clear summaries for approval cards.
- Tools do not claim access to another module's internals.

## Storage

- Module KV use is small, scoped, and documented.
- Sensitive KV values are marked sensitive.
- Durable relational data requirements are not hidden in ad hoc files; external SQL migrations are
  out of scope for v1.

## Install Decision

- You trust the module source and maintainer.
- You are comfortable with its network, filesystem, credential, UI, and tool behavior.
- You can remove the module directory and disable its module entry if it misbehaves.
