"""Verify the fixed Session endpoint's TLS without authentication or SQL."""
import datetime
import json
from pathlib import Path
import socket
import ssl
import struct
import sys

host = "aws-0-us-east-1.pooler.supabase.com"
result = {
    "checked_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "host": host,
    "port": 5432,
    "database_authentication_attempted": False,
    "sql_executed": False,
}
try:
    addresses = socket.getaddrinfo(host, 5432, type=socket.SOCK_STREAM)
    result["dns_ok"] = True
    result["ipv4_available"] = any(a[0] == socket.AF_INET for a in addresses)
    with socket.create_connection((host, 5432), timeout=10) as connection:
        result["tcp_ok"] = True
        connection.sendall(struct.pack("!II", 8, 80877103))  # PostgreSQL SSLRequest
        if connection.recv(1) != b"S":
            raise RuntimeError("TLS not offered")
        context = ssl.create_default_context(cafile=str(Path(__file__).parent / "certs" / "supabase-prod-ca-2021.crt"))
        with context.wrap_socket(connection, server_hostname=host) as tls:
            result["tls_hostname_verified"] = True
            result["tls_version"] = tls.version()
    result["passed"] = True
except Exception as error:
    result["passed"] = False
    result["error_type"] = type(error).__name__  # Never print server response/errors.
    if isinstance(error, ssl.SSLCertVerificationError):
        result["tls_verify_code"] = error.verify_code
        # OpenSSL verification diagnostic only; no database/server payload.
        result["tls_verify_reason"] = error.verify_message
print(json.dumps(result, sort_keys=True))
sys.exit(0 if result["passed"] else 1)
