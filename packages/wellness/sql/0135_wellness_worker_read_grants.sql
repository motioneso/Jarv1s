-- #671 probe: table-level GRANT only, no RLS policy yet.
GRANT SELECT ON app.wellness_checkins TO jarvis_worker_runtime;
GRANT SELECT ON app.medications TO jarvis_worker_runtime;
GRANT SELECT ON app.medication_logs TO jarvis_worker_runtime;
GRANT SELECT ON app.wellness_therapy_notes TO jarvis_worker_runtime;
