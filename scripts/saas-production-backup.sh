#!/usr/bin/env bash
set -euo pipefail
umask 077
# Run on a trusted computer. Never paste the connection URL in chat.
command -v python3 >/dev/null
command -v npx >/dev/null
command -v docker >/dev/null
docker info >/dev/null 2>&1
read -r -s -p 'Studio Flow production Session Pooler URL (hidden): ' backup_source_url
printf '\n'
export BACKUP_SOURCE_URL="$backup_source_url"
python3 - <<'PY'
import os, sys
from urllib.parse import urlsplit, unquote
u=urlsplit(os.environ['BACKUP_SOURCE_URL'])
ref='qfhojvgvhrbautvczffq'
valid=(u.scheme in ('postgres','postgresql') and u.password and u.path=='/postgres' and
 ((u.hostname=='db.'+ref+'.supabase.co' and u.username=='postgres') or
 ((u.hostname or '').endswith('.pooler.supabase.com') and unquote(u.username or '')=='postgres.'+ref and u.port==5432)))
if not valid:
 sys.exit('Use the production direct connection or Session Pooler on port 5432; URL rejected.')
PY
backup_dir="${PWD}/studio-flow-backup-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$backup_dir"
backup_cli=(npx --yes supabase@2.120.0 db dump --db-url "$backup_source_url")
# Logs may contain sensitive connection information: keep local and private.
"${backup_cli[@]}" --role-only --file "$backup_dir/roles.sql" >"$backup_dir/private.log" 2>&1
"${backup_cli[@]}" --file "$backup_dir/schema.sql" >>"$backup_dir/private.log" 2>&1
"${backup_cli[@]}" --data-only --use-copy --exclude storage.buckets_vectors --exclude storage.vector_indexes --file "$backup_dir/data.sql" >>"$backup_dir/private.log" 2>&1
"${backup_cli[@]}" --schema supabase_migrations --file "$backup_dir/history_schema.sql" >>"$backup_dir/private.log" 2>&1
"${backup_cli[@]}" --schema supabase_migrations --data-only --use-copy --file "$backup_dir/history_data.sql" >>"$backup_dir/private.log" 2>&1
unset BACKUP_SOURCE_URL backup_source_url backup_cli
python3 - "$backup_dir" <<'PY'
import hashlib, json, sys
from pathlib import Path
p=Path(sys.argv[1]); files={}
for name in ['roles.sql','schema.sql','data.sql','history_schema.sql','history_data.sql']:
 b=(p/name).read_bytes()
 if not b.strip(): raise SystemExit('Empty export: '+name)
 files[name]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
(p/'manifest.json').write_text(json.dumps({'project_ref':'qfhojvgvhrbautvczffq','files':files,'restore_verified':False,'additional_required':['auth/storage custom schema objects','Storage file contents','Vault encryption root key if used','Edge/configuration snapshot']},indent=2)+'\n')
PY
printf 'Logical export created at %s. Restoration and additional coverage remain unverified.\n' "$backup_dir"
