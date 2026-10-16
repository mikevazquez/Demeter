# Public CA for the fixed Supabase Session pooler

Public certificate only; no private key or credentials.

Downloaded over verified HTTPS from the URL used by the official Supabase Studio
configuration (`ssl:certificate_url`, production):

- Source configuration: https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json
- Certificate: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
- Retrieved: 2026-10-16 UTC.
- PEM file SHA-256: `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`.
- X.509 SHA-256 fingerprint: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.
- Subject/issuer: Supabase Root 2021 CA; expires 2031-04-26 10:56:53 UTC.

This reviewed file is used only for the fixed shared Session endpoint. Direct
connections retain the existing system-root contract. Hostname verification stays
enabled. No runtime download, trust-on-first-use, arbitrary CA path or URL option
is accepted. Rotation requires another reviewed controller change; a missing,
expired or incompatible certificate must fail closed.
