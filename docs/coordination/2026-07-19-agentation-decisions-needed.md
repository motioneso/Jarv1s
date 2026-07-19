# Agentation — Decisions and Inputs Needed

**Run:** `2026-07-19-1179-pdf-bundle`  
**Source:** pending annotations from the live `5178` instance  
**Rule:** annotations are one-way intake. Discussion happens here; no issue or build starts until explicitly requested.

## Decisions needed

### 1. Memory folder chooser

Annotations: `mrs7ahq4-tqxreq`, `mrs7bpwk-aaww5b`

Need a decision:

- Should the chooser move to Data Sources and appear only after a notes source is connected?
- Or should it stay under Memory and always expose folders available inside the container?
- Should rows such as `People` be selectable folders, informational roots, or removed?

### 2. Stub embedding provider

Annotation: `mrs7esoy-5vom9w`

Need a decision: hide `stub` from normal users as a dev/test-only option, or retain it with a clear user-facing purpose and explanation.

### 3. YOLO mode behavior

Annotations: `mrs7glmb-381n6c`, `mrs7h432-mdsidg`

Need:

- The exact chat prompt/action that failed, what side effect was expected, and what happened instead.
- Whether the drawer toggle controls only the current conversation or changes the global YOLO setting.
- Whether a newly opened conversation inherits the global setting or starts with YOLO off.

### 4. Sports organization

Annotations: `mrs6ikaz-7yxxu9`, `mrs6l17v-o14jkx`

Confirm this default:

- Show leagues containing followed teams first.
- If no teams are followed, show all leagues.
- Let users add more leagues manually.
- Show the follow-team prompt initially, then persist dismissal per user.

### 5. News topics

Annotation: `mrs6e5xf-38fy5c`

Need the initial topic source: use categories already present in article data, or define a fixed curated topic list. Subpages remain later scope.

### 6. Issue packaging

Need direction on whether to create:

- One issue per area: News, Sports, Settings polish, Settings defects, and YOLO; or
- A smaller number of approved bundles.

## Ready for issue creation without more product decisions

- News layout: `mrs6fnq4-zwv9ak`, `mrs6fzi5-6xxaah`, `mrs6kba3-kbjwv6`
- Settings profile/location/appearance/navigation polish: `mrs6nwxo-retj99`, `mrs6ounh-hcmg1m`, `mrs6p20v-ly0lth`, `mrs6pc4e-7vnnsy`, `mrs6pwcc-7fddqk`, `mrs6qsrk-vhcc05`, `mrs6s2g7-aupxgf`, `mrs7kslm-upor2w`
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
