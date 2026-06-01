-- EasyHost / Supabase: speed up task reporting (COUNT + GROUP BY on property_tasks).
-- Run in Supabase SQL Editor or apply automatically via Flask ensure_property_tasks_reporting_indexes().
--
-- With tenant_id + created_at selective queries, PostgreSQL can answer 100k+ row aggregates in milliseconds.

CREATE INDEX IF NOT EXISTS idx_property_tasks_report_tenant_created
  ON property_tasks (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_property_tasks_report_tenant_status
  ON property_tasks (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_property_tasks_report_tenant_completed
  ON property_tasks (tenant_id, completed_at)
  WHERE completed_at IS NOT NULL AND completed_at != '';

COMMENT ON INDEX idx_property_tasks_report_tenant_created IS 'Task reporting: filter by tenant + created_at range';
COMMENT ON INDEX idx_property_tasks_report_tenant_status IS 'Task reporting: filter by tenant + status (in-progress breakdown)';
COMMENT ON INDEX idx_property_tasks_report_tenant_completed IS 'Task reporting: completed tasks by completed_at window';
