#!/usr/bin/env bash
# Creates (or reuses) a Neon database branch for CI or a preview deployment,
# then writes its two connection strings to $GITHUB_OUTPUT:
#   owner_url  direct host, neondb_owner: for migrations and test setup
#   app_url    pooled host, architrac_app: what the app itself uses (RLS applies)
#
# Usage: scripts/ci/neon-branch.sh <branch-name> [parent-branch]
# Needs: NEON_API_KEY, NEON_PROJECT_ID, NEON_APP_ROLE_PASSWORD
# Optional: EXPIRES_IN_HOURS (new branches delete themselves after this long)
#
# Why the app URL is built by hand: architrac_app was created with SQL
# (src/db/sql/create-app-role.sql), so Neon can't show its password.
# Every branch inherits the role with the same password, so we take the
# owner's pooled URL and swap in the app login.
set -euo pipefail

name="$1"
parent="${2:-main}"
neon=(pnpm dlx neonctl@8 --project-id "$NEON_PROJECT_ID")

if "${neon[@]}" branches get "$name" --output json >/dev/null 2>&1; then
  echo "Reusing Neon branch $name"
else
  echo "Creating Neon branch $name from $parent"
  expiry=()
  if [[ -n "${EXPIRES_IN_HOURS:-}" ]]; then
    # Safety net: Neon deletes the branch itself if the cleanup step never runs.
    expiry=(--expires-at "$(node -e 'console.log(new Date(Date.now() + process.argv[1] * 3600e3).toISOString())' "$EXPIRES_IN_HOURS")")
  fi
  "${neon[@]}" branches create --name "$name" --parent "$parent" "${expiry[@]}" --output json >/dev/null
fi

owner_url=$("${neon[@]}" connection-string "$name" --role-name neondb_owner --database-name neondb)
owner_pooled=$("${neon[@]}" connection-string "$name" --role-name neondb_owner --database-name neondb --pooled)

app_url=$(node -e '
  const u = new URL(process.argv[1]);
  u.username = "architrac_app";
  u.password = process.env.NEON_APP_ROLE_PASSWORD;
  console.log(u.toString());
' "$owner_pooled")

# Hide the URLs (they contain passwords) from the workflow logs.
echo "::add-mask::$owner_url"
echo "::add-mask::$app_url"
{
  echo "owner_url=$owner_url"
  echo "app_url=$app_url"
} >>"$GITHUB_OUTPUT"
