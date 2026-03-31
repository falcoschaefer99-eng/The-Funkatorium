# Migration Guide

Run SQL files in numeric order.

## Files (current)

1. `001_initial_schema.sql`
2. `002_fts_and_columns.sql`
3. `003_surface_count.sql`
4. `004_entity_model.sql`
5. `005_daemon_intelligence.sql`
6. `006_sprint6_foundation.sql`
7. `007_project_dossiers_and_wake_delta.sql`
8. `008_dispatch_calibration_and_agent_manifests.sql`
9. `009_predeploy_perf_and_integrity.sql`
10. `010_batch_entity_observations_index.sql`
11. `011_autonomous_runtime_ledger.sql`
12. `012_runtime_policy_and_budgeting.sql`
13. `013_captured_skill_registry.sql`
14. `014_captured_skill_registry_perf.sql`

## Option A — psql (recommended)

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@HOST/DB?sslmode=require'

for f in $(ls migrations/*.sql | sort); do
  echo "Applying $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

## Option B — Neon SQL editor

Open each file and run in order (001 → 014).

## Verify

Quick sanity checks:

```sql
-- runtime ledger table
select count(*) from agent_runtime_runs;

-- captured skill registry
select count(*) from captured_skills;

-- proposal table
select count(*) from daemon_proposals;
```

## Notes

- Keep `ON_ERROR_STOP=1` so failures stop the run.
- Do not skip files; later migrations assume earlier schema.
- Back up production DB before applying new migrations.
