# #983 source-preserving finding matrix

## Recovery limitation

#983 says the retained recording contains **37 findings**. The currently exposed child-issue bodies
(#984–#995) contain **40 timestamp-bearing checkbox bullets**, several with overlapping timestamps
or ownership, plus untimestamped supporting bullets. The original local transcript/video was not
available in this lane. Therefore a one-to-one 37-item reconstruction would require guessing.

This matrix preserves every exposed timestamp-bearing bullet under a stable `issue.ordinal` key.
It does not invent original finding numbers or silently merge overlaps. `PASS` means direct live
proof at the target head; `PARTIAL` means only part of the source claim was directly observed;
`UNPROVEN` means the run did not establish the claim.

Target: `4420663551afa52ad6da05e9f5696fe0e8d3ab60`

| Source key | Timestamp and source finding | Exact-head disposition |
| --- | --- | --- |
| 984.1 | 33:32–35:15 — private-chat trust | PARTIAL: private disclosure and history surfaces captured (15, 16); post-refresh/re-login storage absence not proven. |
| 984.2 | 33:47–34:04 — private context semantics | UNPROVEN: no configured response/context consequence was available. |
| 984.3 | 34:38–35:54 — history usability | PARTIAL: history is readable in 16; resume/continue was not completed end to end. |
| 985.1 | 13:37–13:55, 28:46–28:55, 32:24–33:10 — autonomy mismatch | UNPROVEN: YOLO/native/installed-tool approval consequences were not exercised. |
| 985.2 | 32:24–32:50 — approval presentation | UNPROVEN: a live approval prompt was not generated. |
| 985.3 | 10:12–10:41, 33:15–33:19 — shared popovers | UNPROVEN: outside-click/Escape/selection behavior was not logged. |
| 986.1 | 02:56–03:18 — overlapping admin destinations | PASS: Admin rail shows the merged People & access destination (30). |
| 986.2 | 03:18–03:35 — negative identity guidance | PASS for visible replacement: People & access presents registration/member state without the old dead-end copy (30). |
| 986.3 | 04:30–04:44 — tracked export/backup promises | PASS for visible mapping: Audit shows `Coming soon · #1069` and `· #1070` (34). |
| 986.4 | 12:29–13:21 — Settings layout/copy | PARTIAL: broad desktop Settings capture is readable; narrow Settings layout is captured, but Today has a separate wrap regression (17–36, 46, 49). |
| 986.5 | 16:00–16:22 — sticky Settings rail | PARTIAL: navigation remained visible/reachable in captured states; a long scroll interaction was not logged. |
| 986.6 | 22:38–23:21 — missing installed modules | PARTIAL: personal/admin Modules surfaces render (25, 32); every non-toggleable module detail was not enumerated. |
| 986.7 | 23:24–23:39, 25:32–25:39 — module detail navigation | PASS for News: real Modules → Configure News route shows `Back to modules` on desktop/narrow (36, 46). Other module details were not exhaustively proven. |
| 986.8 | 31:19–31:38 — overlapping personal destinations | PASS: Personal rail shows merged Account & preferences (17). |
| 987.1 | 18:03–19:36 — People folder dead end | UNPROVEN: Data sources rendered (24), but mapped People discovery/refresh was not executed. |
| 987.2 | 19:45–20:00 — manual person ambiguity | UNPROVEN: manual People creation was not exercised. |
| 987.3 | 21:50–22:33 — Notes source dead end | UNPROVEN: Data sources rendered (24), but authorized-folder selection/recovery was not exercised. |
| 987.4 | 21:50–21:58 — delete approval label | UNPROVEN: no pending delete approval was generated. |
| 988.1 | 00:31–00:42 — Today redundant ranking/due labels | UNPROVEN: Today captures do not unambiguously prove the original fixture/label requirement; narrow Today fails wrapping (03, 29, 47). |
| 988.2 | 00:51–01:20 — News/Sports imagery | PARTIAL: News image success and real article link passed (06; log 8); graceful failure was not validly simulated; Sports title truncates (11). |
| 988.3 | 30:17–30:54 — independent Appearance mode/accent | PASS: all 10 accent×mode runtime combinations passed (log 27); desktop/narrow Dark+Dusk captured (28, 49). |
| 989.1 | 23:52–25:32 — Sports follow state | UNPROVEN: Sports landing route captured (11); follow Settings interactions were not exercised. |
| 990.1 | 25:45–26:41 — News topic entry | PARTIAL: curated Technology add/remove via Enter passed (log 37); freeform Add topic was disabled without web search (36; log 42). |
| 991.1 | 09:00–11:51 — personality editing | UNPROVEN: Assistant surface captured (18); text/dial save/reversal not exercised. |
| 991.2 | 09:44–10:57 — false voice state | PARTIAL: the microphone truthfully identifies missing transcription setup (log 14); configured voice preview was not available. |
| 991.3 | 12:06–13:21 — model selection | UNPROVEN: personal/admin model surfaces captured (18, 31); switch/default consequences not exercised. |
| 991.4 | 13:21–13:55 — YOLO setting | UNPROVEN: effective approval behavior not exercised. |
| 991.5 | 14:09–15:51 — Priorities vocabulary | PARTIAL: current Priorities surface captured (19); comprehension/effect was not exercised. |
| 991.6 | 14:54–15:08 — Add an anchor | UNPROVEN: add/validation/save behavior not exercised. |
| 992.1 | 16:22–17:53 — memory semantic quality | PARTIAL: current Memory surface captured (20); semantic quality, Pin/Forget, history, and privacy consequences were not exercised. |
| 993.1 | 05:43–06:33 — Herdr state | PARTIAL: host page visibly reports tmux available and Herdr unavailable/not installed (35); deployed-host reconciliation was not safely changed. |
| 993.2 | 06:42–06:50 — diagnostics | UNPROVEN: Check system health remained `Not run yet` (35). |
| 993.3 | 06:50–07:09 — log level | UNPROVEN: no live log-level action was exercised. |
| 993.4 | 07:17–08:01 — account email | PARTIAL: Account & preferences captured (17); secure email-change flow not exercised. |
| 993.5 | 07:17–07:35 — profile hierarchy | PASS for current visual state: Account & preferences is readable on desktop (17). |
| 994.1 | 26:47–30:13 — Skills Settings hierarchy | PARTIAL: Skills renders (26); Create/Upload interactions were not exercised. |
| 994.2 | 28:21–29:21 — slash-command invocation UI | UNPROVEN: no skill invocation was run. |
| 995.1 | 04:57–05:43, 20:08–21:07 — connected-account health | PARTIAL: Connected accounts and Connector oversight render truthful visible state (23, 33); recovery/freshness consequences were not exercised. |
| 995.2 | 21:13–21:40 — missing provider path | PARTIAL: Connected accounts rendered (23); IMAP/iCloud delivery paths were not completed. |
| 995.3 | 21:07–21:13 — unverified email/calendar grants | UNPROVEN: grant behavior was not tested end to end. |

## Untimestamped supporting source material

The child issues also contain untimestamped supporting bullets, including Sports hierarchy/catalog,
News topic weight and feedback, Memory tags/Pin/history, Skills body/save/upload, and Connected
accounts Apple/Other-provider wording. Those are retained as acceptance context in the child issues
but cannot be assigned to the claimed original 37 without the local transcript/video. Relevant
live gaps are reflected in `988-acceptance-ledger.md` and `uat-report.md`.

## #1002 supporting inventory

#1002 is a separate untimestamped promise inventory, not one of the reconstructed source rows. This
run directly confirms only the Audit & operations promises for instance export and backup/restore,
each labeled with its open tracker (#1069 and #1070) in screenshot 34. Other inventory rows retain
their GitHub dispositions but were not all re-proven live in this run.
