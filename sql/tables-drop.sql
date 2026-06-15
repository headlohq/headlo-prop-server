-- ============================================================
-- PROP Schema — Drop All
-- ============================================================
-- Drops everything so tables-clean-install.sql can be re-run
-- from scratch. CASCADE handles FKs and indexes automatically.
-- ============================================================

DROP SCHEMA IF EXISTS prop_component CASCADE;
DROP SCHEMA IF EXISTS prop_service   CASCADE;
DROP SCHEMA IF EXISTS prop_server    CASCADE;
