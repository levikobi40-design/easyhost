-- Rename AgentMemory.metadata to extra_details (metadata is reserved in SQLAlchemy)
-- PostgreSQL: psql $DATABASE_URL -f migrations/002_rename_agent_memory_metadata.sql
-- SQLite: sqlite3 luxury.db "ALTER TABLE agent_memory RENAME COLUMN metadata TO extra_details;"
-- Note: Run only if agent_memory table exists with a metadata column. For fresh installs, the app creates the correct schema.

ALTER TABLE agent_memory RENAME COLUMN metadata TO extra_details;
