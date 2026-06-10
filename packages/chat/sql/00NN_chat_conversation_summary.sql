ALTER TABLE app.chat_threads
  ADD COLUMN IF NOT EXISTS conversation_summary text;
