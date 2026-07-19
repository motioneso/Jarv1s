# Agentation — Decisions and Inputs Needed

**Run:** `2026-07-19-1179-pdf-bundle`  
**Source:** pending annotations from the live `5178` instance  
**Rule:** annotations are one-way intake. Discussion happens here; no issue or build starts until explicitly requested.

Implemented changes awaiting review are tracked separately in `~/Jarv1s/docs/coordination/2026-07-19-agentation-addressed-for-review.md`.

## Decisions recorded from Ben

### People folder mapping

Annotations: `mrs7ahq4-tqxreq`, `mrs7bpwk-aaww5b`

Tracking: [#1181](https://github.com/motioneso/Jarv1s/issues/1181)

- This is a People feature, not a Memory feature.
- Make People-folder use an explicit on/off setting.
- When enabled, the folder selector must show the folders the user has mapped/selected for People.
- If the user has no selected People folder, Jarvis may use a default People folder.
- Do not present the current `People` row as an unexplained informational root; the UI must communicate the active mapping.

### Embedding-provider choice

Annotation: `mrs7esoy-5vom9w`

Tracking: [#1182](https://github.com/motioneso/Jarv1s/issues/1182)

- Do not offer normal users a provider choice when the options have no understandable user benefit.
- Hide the `stub` option and the user-facing embedding-provider selector unless a real user-facing reason for choosing providers is established.
- Provider selection may remain an internal/dev concern in the meantime.

### Read-only context and tool approvals

Annotations: `mrs7glmb-381n6c`, `mrs7h432-mdsidg`

Tracking: [#1183](https://github.com/motioneso/Jarv1s/issues/1183)

- Repro: with YOLO off, asking chat whether it can tell which page is open surfaces tool-permission UI.
- Reading page/context information must not produce a tool approval prompt.
- Approval UI is for actions that create, modify, or otherwise have side effects.
- Mutating approvals need a durable option equivalent to **Yes, and don't ask again for this tool/command** rather than forcing the same approval repeatedly.

### Sports standings and follows

Annotations: `mrs6ikaz-7yxxu9`, `mrs6l17v-o14jkx`

Tracking: [#1184](https://github.com/motioneso/Jarv1s/issues/1184)

- With no follows, show a sensible default set: the major US sports/leagues plus the top soccer leagues.
- When a user follows a team or league, prioritize those leagues in the default standings view.
- Put the remaining leagues behind **More**.
- In **More**, users can star leagues to add them to the default standings view.
- Keep the follow-team prompt optional and dismissible; persist dismissal per user.

### News image/caption hierarchy and text fallback

Related layout annotations: `mrs6fnq4-zwv9ak`, `mrs6fzi5-6xxaah`, `mrs6kba3-kbjwv6`

Tracking: [#1185](https://github.com/motioneso/Jarv1s/issues/1185)

- Make it visually unambiguous that the caption below an image belongs to that image; adjacent left/right article copy must not read like the image caption.
- When an article has no image, show more article text before **Continue reading** so the card does not feel prematurely truncated.

## Decisions still needed

### Color-mode rearrange target

Annotations: `mrs74jai-oh5ztv`, `mrs9a182-qhp8y3`, `mrs9q3h1-dl5euy`, `mrs9wryn-hp4nzm`

The same rearrange payload says to move Color mode, but events point to Assistant settings, Today, Instance Modules, and now Finance. Confirm the intended destination before implementation; keep all copies open meanwhile.

### News topic source

Annotation: `mrs6e5xf-38fy5c`

Ben's response clarified News layout rather than the initial topic source. Still choose whether the first topic list comes from categories already present in article data or from a fixed curated topic list. Subpages remain later scope.

## Ready for issue creation without more product decisions

- Module install dialog copy: `mrs94lf2-v77w9l` — replace the implementation-shaped permissions list with a useful description of what the module does; retain only permission/risk information that benefits a normal user.
- Remaining Settings appearance/navigation polish: `mrs6qsrk-vhcc05`, `mrs6s2g7-aupxgf`, `mrs7kslm-upor2w`
- Settings Assistant/Memory polish: `mrs75paa-g8oyyp`, `mrs76gsz-akmshz`, `mrs78asb-befxrt`, `mrs79332-a3shdo`
- Settings defects: `mrs6arkr-3c85gx`, `mrs6bbol-p7gxya`, `mrs776lh-bmzmj5`, `mrs77jy9-33ynvd`
- Connected/Oversight/Modules cleanup: `mrs7cn4e-wts5qg`, `mrs7d04t-i9o3cy`, `mrs7mknx-iekzvf`, `mrs7n6bc-7aqwjr`, `mrs7nz2f-g2ngs8`, `mrs7ofm2-2okb7q`
- Host guidance and typography: `mrs7pqjl-v6hvxl`, `mrs7q4xr-erj12w`
- Connector onboarding parity: `mrs67gef-h4qiyt`, `mrs69zpx-rxknnt`

## Comment closure protocol

- Discussion or issue creation alone does not close an annotation.
- After the requested change is implemented and verified, resolve the original annotation and any synced duplicate with a concise completion summary.
- If a request is explicitly declined or withdrawn, close it with that reason.
- Until then, leave it pending so the browser remains the visible source of truth.

## Known synced duplicates

The `mrs74j*` Settings annotations replay already-recorded `mrs6*` feedback after the live instance restarted. Do not create duplicate issues; close both IDs together when their shared change is verified.
