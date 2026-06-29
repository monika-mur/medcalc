---
name: db-migrate
description: Create a new Supabase migration, apply it to the local DB, and regenerate TypeScript types. Requires the local Supabase stack to be running.
disable-model-invocation: true
---

Run a Supabase migration workflow for $ARGUMENTS (migration name, e.g. "add_medications_table").

Prerequisites: local Supabase stack must be running (`npx supabase start`).

1. Create a new migration file:
   ```
   npx supabase migration new $ARGUMENTS
   ```
   A timestamped SQL file is created in `supabase/migrations/`.

2. Write the SQL schema changes in that file.

3. Apply all migrations by resetting the local database:
   ```
   npx supabase db reset
   ```
   This re-runs all migrations from scratch on the local Docker stack.

4. Regenerate TypeScript types from the updated schema:
   ```
   npx supabase gen types typescript --local > src/lib/database.types.ts
   ```

5. Import the generated types in Supabase client calls where needed.
