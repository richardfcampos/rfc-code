# Database Security

## Table of Contents
- [Access Control](#access-control)
- [SQL Injection Prevention](#sql-injection-prevention)
- [Encryption](#encryption)
- [Auditing & Logging](#auditing--logging)
- [Network Security](#network-security)
- [Backup Security](#backup-security)
- [Engine-Specific Security](#engine-specific-security)
- [Security Checklist](#security-checklist)

## Access Control

### Principle of Least Privilege
```sql
-- MySQL: create application user with minimal permissions.
CREATE USER 'app_user'@'10.0.%' IDENTIFIED BY 'strong_password_here';
GRANT SELECT, INSERT, UPDATE, DELETE ON mydb.* TO 'app_user'@'10.0.%';
-- No GRANT OPTION, no CREATE/DROP, no SUPER.

-- Read-only replica user.
CREATE USER 'readonly'@'10.0.%' IDENTIFIED BY 'strong_password';
GRANT SELECT ON mydb.* TO 'readonly'@'10.0.%';

-- Migration user (used only during deployments).
CREATE USER 'migrator'@'10.0.%' IDENTIFIED BY 'strong_password';
GRANT ALL PRIVILEGES ON mydb.* TO 'migrator'@'10.0.%';

-- PostgreSQL: role-based access.
CREATE ROLE app_read;
GRANT CONNECT ON DATABASE mydb TO app_read;
GRANT USAGE ON SCHEMA public TO app_read;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_read;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_read;

CREATE ROLE app_write;
GRANT app_read TO app_write;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_write;

CREATE USER app_service WITH PASSWORD 'strong_password';
GRANT app_write TO app_service;
```

### Row-Level Security (PostgreSQL)
```sql
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Users can only see their own documents.
CREATE POLICY user_documents ON documents
    USING (owner_id = current_setting('app.user_id')::INT);

-- Admins can see all.
CREATE POLICY admin_all ON documents
    USING (current_setting('app.role') = 'admin');

-- Set context per request.
SET app.user_id = '123';
SET app.role = 'user';
```

### Password Policies
- Minimum 16 characters, random.
- Rotate every 90 days.
- Never store in code, `.env`, or version control.
- Use secrets management (Vault, AWS Secrets Manager, etc.).
- Application accounts: use IAM authentication where possible (AWS RDS IAM, GCP Cloud SQL IAM).

## SQL Injection Prevention

### Always Parameterize
```php
// VULNERABLE — never do this.
$query = "SELECT * FROM users WHERE email = '$email'";

// SAFE — parameterized query (PDO).
$stmt = $pdo->prepare('SELECT * FROM users WHERE email = :email');
$stmt->execute(['email' => $email]);

// SAFE — Laravel Eloquent (parameterized by default).
$user = User::where('email', $email)->first();

// SAFE — Laravel Query Builder.
$user = DB::table('users')->where('email', $email)->first();

// SAFE — WordPress.
$results = $wpdb->get_results(
    $wpdb->prepare("SELECT * FROM {$wpdb->users} WHERE user_email = %s", $email)
);
```

### Dangerous Patterns to Avoid
```php
// Bad: dynamic table/column names from user input.
$table = $_GET['table'];
$query = "SELECT * FROM $table";    // Table name injection.

// Safe: allowlist valid table names.
$allowed = ['users', 'orders', 'products'];
if (!in_array($table, $allowed, true)) {
    throw new InvalidArgumentException('Invalid table');
}

// Bad: ORDER BY from user input.
$order = $_GET['sort'];
$query = "SELECT * FROM users ORDER BY $order";

// Safe: allowlist columns.
$allowed_columns = ['name', 'email', 'created_at'];
$order = in_array($_GET['sort'], $allowed_columns, true) ? $_GET['sort'] : 'created_at';
```

### ORM Safety
- ORMs (Eloquent, Doctrine, ActiveRecord) parameterize by default.
- Danger: raw expressions, `DB::raw()`, `whereRaw()`.
- Always parameterize raw expressions: `DB::raw('price > ?', [100])`.

## Encryption

### Encryption at Rest
```sql
-- MySQL: InnoDB tablespace encryption.
ALTER TABLE sensitive_data ENCRYPTION='Y';

-- PostgreSQL: use pgcrypto for column-level encryption.
CREATE EXTENSION pgcrypto;

INSERT INTO users (email, ssn_encrypted)
VALUES ('user@example.com', pgp_sym_encrypt('123-45-6789', 'encryption_key'));

SELECT pgp_sym_decrypt(ssn_encrypted, 'encryption_key') FROM users;
```

### Cloud Encryption
| Feature | AWS RDS | GCP Cloud SQL | Azure SQL |
|---------|---------|---------------|-----------|
| At-rest | AES-256 (KMS) | AES-256 (CMEK) | TDE (AES-256) |
| In-transit | SSL/TLS required | SSL/TLS required | TLS 1.2+ |
| Key management | KMS / customer-managed | CMEK | Azure Key Vault |

### Enforce TLS Connections
```sql
-- MySQL: require SSL for user.
ALTER USER 'app_user'@'%' REQUIRE SSL;

-- PostgreSQL: pg_hba.conf.
-- hostssl  mydb  app_user  10.0.0.0/8  scram-sha-256

-- Verify connection encryption.
-- MySQL:
SHOW STATUS LIKE 'Ssl_cipher';
-- PostgreSQL:
SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid();
```

## Auditing & Logging

### What to Audit
| Event | Priority | Why |
|-------|----------|-----|
| Failed logins | Critical | Brute force detection |
| Schema changes (DDL) | Critical | Unauthorized modifications |
| Privilege grants | Critical | Privilege escalation |
| Access to sensitive tables | High | Data exfiltration |
| Data modifications (DML) | Medium | Change tracking |
| Slow queries | Medium | Performance + unusual access |

### MySQL Audit
```ini
# General query log (development only — too verbose for production).
general_log = OFF

# Slow query log (production-safe).
slow_query_log = ON
long_query_time = 1

# Enterprise: MySQL Enterprise Audit Plugin.
# Community: MariaDB Audit Plugin or Percona Audit Log.
```

### PostgreSQL Audit
```ini
# postgresql.conf.
log_connections = on
log_disconnections = on
log_statement = 'ddl'           # Log all DDL statements.
log_min_duration_statement = 500  # Log queries > 500ms.

# pgAudit extension (granular auditing).
# shared_preload_libraries = 'pgaudit'
# pgaudit.log = 'write, ddl, role'
```

### Trigger-Based Audit Trail
```sql
-- Generic audit trigger (PostgreSQL).
CREATE OR REPLACE FUNCTION audit_trigger() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, user_id)
    VALUES (
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        TG_OP,
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN row_to_json(OLD) END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN row_to_json(NEW) END,
        current_setting('app.user_id', true)::INT
    );
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_users
    AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
```

## Network Security

### Access Restrictions
```
# Only allow connections from application subnet.
# MySQL: bind-address = 10.0.1.100
# PostgreSQL: listen_addresses = '10.0.1.100'

# Firewall: only allow port 3306/5432 from app servers.
# AWS: Security Groups — inbound 5432 from app SG only.
# Never expose database port to internet.
```

### Connection Encryption
- Enforce TLS 1.2+ for all connections.
- Use certificate-based authentication when possible.
- Rotate certificates annually.

### VPC / Private Networking
- Database in private subnet (no public IP).
- Access via VPN, bastion host, or private endpoint.
- AWS: VPC endpoints for DynamoDB/S3.
- GCP: Private Service Connect.

## Backup Security

### Backup Encryption
- Encrypt all backups at rest (AES-256).
- Encrypt backups in transit (TLS).
- Store encryption keys separately from backups.
- Test restore process regularly (quarterly minimum).

### Backup Access Control
- Separate IAM roles for backup creation vs restore.
- Restrict who can delete backups.
- Cross-account backup copies for ransomware protection.
- Immutable backups where supported (AWS Backup Vault Lock).

## Engine-Specific Security

### MySQL Hardening
```sql
-- Remove anonymous users.
DELETE FROM mysql.user WHERE User = '';

-- Remove remote root.
DELETE FROM mysql.user WHERE User = 'root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');

-- Disable local file loading.
SET GLOBAL local_infile = 0;

-- Validate password plugin.
INSTALL COMPONENT 'file://component_validate_password';
SET GLOBAL validate_password.policy = STRONG;
SET GLOBAL validate_password.length = 16;

FLUSH PRIVILEGES;
```

### PostgreSQL Hardening
```ini
# pg_hba.conf — strict authentication.
# TYPE   DATABASE  USER       ADDRESS       METHOD
local    all       postgres                  peer
hostssl  mydb      app_user   10.0.0.0/8    scram-sha-256
host     all       all        0.0.0.0/0     reject

# postgresql.conf.
password_encryption = scram-sha-256
ssl = on
ssl_min_protocol_version = TLSv1.2
```

### MongoDB Security
```javascript
// Enable authentication.
// mongod.conf: security.authorization: "enabled"

// Create admin user.
db.createUser({
  user: "admin",
  pwd: "strong_password",
  roles: [{ role: "userAdminAnyDatabase", db: "admin" }]
});

// Application user with minimal permissions.
db.createUser({
  user: "app_user",
  pwd: "strong_password",
  roles: [{ role: "readWrite", db: "mydb" }]
});

// Enable TLS.
// mongod.conf:
// net.tls.mode: requireTLS
// net.tls.certificateKeyFile: /path/to/server.pem
```

## Security Checklist

### Authentication
- [ ] No default/anonymous accounts.
- [ ] Strong passwords (16+ chars, random).
- [ ] Secrets in vault, not code/env files.
- [ ] IAM authentication where supported.
- [ ] Password rotation policy.

### Authorization
- [ ] Least-privilege per user/role.
- [ ] Separate accounts: app, readonly, migration, admin.
- [ ] No shared accounts.
- [ ] Regular access review (quarterly).

### Network
- [ ] Database in private subnet.
- [ ] No public IP / internet access.
- [ ] Firewall: only app servers on DB port.
- [ ] TLS 1.2+ enforced on all connections.

### Encryption
- [ ] Encryption at rest enabled.
- [ ] Encryption in transit (TLS) enforced.
- [ ] Sensitive columns encrypted (PII, credentials).
- [ ] Key rotation schedule.

### Monitoring
- [ ] Failed login alerting.
- [ ] DDL change logging.
- [ ] Slow query logging.
- [ ] Audit trail for sensitive tables.

### Backups
- [ ] Automated backup schedule.
- [ ] Backups encrypted at rest.
- [ ] Restore tested quarterly.
- [ ] Cross-region / cross-account copies.
- [ ] Immutable backup policy.
