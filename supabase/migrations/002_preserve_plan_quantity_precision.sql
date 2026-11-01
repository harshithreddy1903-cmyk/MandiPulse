-- Apply after 001_mandipulse_workspace.sql for new and existing projects.
-- Five quintal decimal places retain the supported minimum of 0.001 kg.
-- Reapplying this migration leaves the same type in place.
alter table public.procurement_plans
  alter column quantity_quintals type numeric(18,5)
  using quantity_quintals::numeric(18,5);
