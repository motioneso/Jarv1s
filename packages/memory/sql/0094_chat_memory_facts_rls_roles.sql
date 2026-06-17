ALTER POLICY chat_memory_facts_select ON app.chat_memory_facts
  TO jarvis_app_runtime, jarvis_worker_runtime;

ALTER POLICY chat_memory_facts_insert ON app.chat_memory_facts
  TO jarvis_app_runtime, jarvis_worker_runtime;

ALTER POLICY chat_memory_facts_update ON app.chat_memory_facts
  TO jarvis_app_runtime, jarvis_worker_runtime;

ALTER POLICY chat_memory_facts_delete ON app.chat_memory_facts
  TO jarvis_app_runtime, jarvis_worker_runtime;
