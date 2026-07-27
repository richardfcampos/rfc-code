# Security Best Practices

## Table of Contents
- [OWASP Top 10 for PHP](#owasp-top-10-for-php)
- [Input Validation & Sanitization](#input-validation--sanitization)
- [Output Escaping](#output-escaping)
- [Authentication & Authorization](#authentication--authorization)
- [SQL Injection Prevention](#sql-injection-prevention)
- [XSS Prevention](#xss-prevention)
- [CSRF Protection](#csrf-protection)
- [File Upload Security](#file-upload-security)
- [Session Security](#session-security)
- [Cryptography](#cryptography)
- [Laravel-Specific Security](#laravel-specific-security)
- [WordPress-Specific Security](#wordpress-specific-security)
- [Security Headers](#security-headers)

## OWASP Top 10 for PHP

| # | Vulnerability | PHP Mitigation |
|---|--------------|----------------|
| 1 | Broken Access Control | Capability checks, policies, middleware |
| 2 | Cryptographic Failures | `sodium_*` or `openssl_*`, never `md5`/`sha1` for passwords |
| 3 | Injection | Parameterized queries, prepared statements, escape output |
| 4 | Insecure Design | Threat model early, validate assumptions, defense in depth |
| 5 | Security Misconfiguration | Disable `display_errors`, hide PHP version, minimal permissions |
| 6 | Vulnerable Components | `composer audit`, keep dependencies updated |
| 7 | Auth Failures | Strong password hashing, rate limiting, MFA |
| 8 | Data Integrity Failures | Verify signatures, validate serialized data, CI/CD security |
| 9 | Logging Failures | Log security events, don't log secrets, monitor anomalies |
| 10 | SSRF | Validate URLs, allowlist domains, block internal IPs |

## Input Validation & Sanitization

### PHP Native
```php
// Type coercion is dangerous — validate explicitly.
$email = filter_input(INPUT_POST, 'email', FILTER_VALIDATE_EMAIL);
$age   = filter_input(INPUT_POST, 'age', FILTER_VALIDATE_INT, [
    'options' => ['min_range' => 1, 'max_range' => 150],
]);

if ($email === false || $email === null) {
    throw new ValidationException('Invalid email');
}
```

### Validation Rules
- **Allowlist over denylist.** Define what IS valid, not what isn't.
- **Validate type, format, range, and length.**
- **Reject early.** Validate at the boundary before processing.
- **Never trust client-side validation.** Always re-validate server-side.

```php
// Allowlist approach.
$allowed_statuses = ['active', 'inactive', 'pending'];
if (! in_array($status, $allowed_statuses, true)) {
    throw new InvalidArgumentException('Invalid status');
}

// Better: use enums.
$status = Status::tryFrom($input) ?? throw new InvalidArgumentException('Invalid status');
```

## Output Escaping

### Context-Specific Escaping
```php
// HTML body.
echo htmlspecialchars($data, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

// HTML attribute.
echo '<input value="' . htmlspecialchars($value, ENT_QUOTES, 'UTF-8') . '">';

// URL parameter.
echo 'https://example.com?q=' . urlencode($query);

// JavaScript context.
echo '<script>var data = ' . json_encode($data, JSON_HEX_TAG | JSON_HEX_AMP) . ';</script>';

// CSS context — avoid embedding user data in CSS entirely.
```

### WordPress Escaping Functions
| Function | Context | Example |
|----------|---------|---------|
| `esc_html()` | HTML body text | `<p><?php echo esc_html($text); ?></p>` |
| `esc_attr()` | HTML attributes | `<div class="<?php echo esc_attr($class); ?>">` |
| `esc_url()` | URLs (href, src) | `<a href="<?php echo esc_url($url); ?>">` |
| `esc_js()` | Inline JS (avoid) | `onclick="do(<?php echo esc_js($val); ?>)"` |
| `wp_kses_post()` | Post content HTML | `<?php echo wp_kses_post($content); ?>` |
| `wp_kses()` | Custom allowed HTML | `echo wp_kses($html, $allowed_tags)` |
| `esc_html__()` | Translatable + escape | `echo esc_html__('Text', 'rgbc')` |

## Authentication & Authorization

### Password Handling
```php
// Hashing — always use password_hash.
$hash = password_hash($password, PASSWORD_ARGON2ID, [
    'memory_cost' => 65536,
    'time_cost'   => 4,
    'threads'     => 3,
]);

// Verification.
if (! password_verify($input, $hash)) {
    throw new AuthenticationException('Invalid credentials');
}

// Check if rehash is needed (algorithm/cost changes).
if (password_needs_rehash($hash, PASSWORD_ARGON2ID)) {
    $newHash = password_hash($input, PASSWORD_ARGON2ID);
    // Update stored hash.
}
```

### Rate Limiting
```php
// Laravel.
Route::middleware('throttle:5,1')->group(function (): void {
    Route::post('/login', [AuthController::class, 'login']);
});

// WordPress: implement via transients.
function rgbc_check_rate_limit(string $key, int $max, int $window): bool {
    $attempts = (int) get_transient("rate_limit_{$key}");
    if ($attempts >= $max) {
        return false;
    }
    set_transient("rate_limit_{$key}", $attempts + 1, $window);
    return true;
}
```

### Authorization Patterns
```php
// Laravel Policy.
class OrderPolicy
{
    public function update(User $user, Order $order): bool
    {
        return $user->id === $order->user_id
            || $user->hasRole('admin');
    }
}

// WordPress Capability Check.
if (! current_user_can('edit_post', $post_id)) {
    wp_die(__('You are not authorized.', 'rgbc'), 403);
}
```

## SQL Injection Prevention

### Never Concatenate User Input
```php
// VULNERABLE — never do this.
// $wpdb->query("SELECT * FROM users WHERE id = " . $_GET['id']);

// SAFE — parameterized query.
$wpdb->get_row($wpdb->prepare(
    "SELECT * FROM {$wpdb->users} WHERE ID = %d",
    absint($id)
));

// Laravel — always use bindings.
DB::select('SELECT * FROM users WHERE id = ?', [$id]);

// Eloquent — safe by default.
User::where('id', $id)->first();
```

### Parameterized Queries (PDO)
```php
$stmt = $pdo->prepare('SELECT * FROM users WHERE email = :email AND status = :status');
$stmt->execute([
    'email'  => $email,
    'status' => $status,
]);
$user = $stmt->fetch(PDO::FETCH_ASSOC);
```

### WordPress `$wpdb->prepare()` Format Strings
| Placeholder | Type | Example |
|-------------|------|---------|
| `%d` | Integer | `$wpdb->prepare("WHERE id = %d", $id)` |
| `%f` | Float | `$wpdb->prepare("WHERE price = %f", $price)` |
| `%s` | String | `$wpdb->prepare("WHERE name = %s", $name)` |
| `%i` | Identifier (table/column) | `$wpdb->prepare("SELECT * FROM %i", $table)` |

## XSS Prevention

### Types and Prevention
| Type | Vector | Prevention |
|------|--------|------------|
| Reflected | URL parameters echoed back | Escape all output from `$_GET`/`$_POST` |
| Stored | Database content rendered | Escape on output, even "trusted" data |
| DOM-based | Client-side JS manipulation | Use `textContent`, not `innerHTML` |

### Content Security Policy
```php
// Set CSP header.
header("Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{$nonce}'; style-src 'self' 'unsafe-inline'");
```

## CSRF Protection

### Laravel (automatic with Blade)
```php
// Blade forms include CSRF automatically.
// <form method="POST">@csrf ... </form>

// For AJAX, include X-CSRF-TOKEN header.
// axios.defaults.headers.common['X-CSRF-TOKEN'] = document.querySelector('meta[name="csrf-token"]').content;

// Verify in middleware (VerifyCsrfToken) — enabled by default.
```

### WordPress (nonces)
```php
// Generate nonce.
$nonce = wp_create_nonce('rgbc_action');

// In form.
wp_nonce_field('rgbc_action', '_rgbc_nonce');

// Verify on submit.
if (! wp_verify_nonce(
    sanitize_text_field(wp_unslash($_POST['_rgbc_nonce'] ?? '')),
    'rgbc_action'
)) {
    wp_die(__('Invalid security token.', 'rgbc'));
}

// For URLs.
$url = wp_nonce_url($base_url, 'rgbc_action', '_rgbc_nonce');
```

## File Upload Security

```php
// Validate file type (never trust Content-Type header).
$allowed_types = ['image/jpeg', 'image/png', 'image/webp'];
$finfo = new finfo(FILEINFO_MIME_TYPE);
$mime = $finfo->file($_FILES['upload']['tmp_name']);

if (! in_array($mime, $allowed_types, true)) {
    throw new SecurityException('Invalid file type');
}

// Validate file extension.
$ext = strtolower(pathinfo($_FILES['upload']['name'], PATHINFO_EXTENSION));
if (! in_array($ext, ['jpg', 'jpeg', 'png', 'webp'], true)) {
    throw new SecurityException('Invalid extension');
}

// Validate file size.
if ($_FILES['upload']['size'] > 5 * 1024 * 1024) {
    throw new SecurityException('File too large');
}

// Generate random filename — never use original name.
$filename = bin2hex(random_bytes(16)) . '.' . $ext;

// Store outside webroot when possible.
move_uploaded_file($_FILES['upload']['tmp_name'], $secure_path . '/' . $filename);

// WordPress: use wp_handle_upload() — handles all validation.
$uploaded = wp_handle_upload($_FILES['upload'], ['test_form' => false]);
```

## Session Security

```php
// PHP session hardening.
ini_set('session.cookie_httponly', '1');
ini_set('session.cookie_secure', '1');
ini_set('session.cookie_samesite', 'Lax');
ini_set('session.use_strict_mode', '1');

// Regenerate session ID after privilege change.
session_regenerate_id(true);
```

## Cryptography

### Do's and Don'ts
| Do | Don't |
|----|-------|
| `password_hash()` with ARGON2ID | `md5()`, `sha1()`, `sha256()` for passwords |
| `random_bytes()` / `random_int()` | `rand()`, `mt_rand()`, `uniqid()` |
| `sodium_crypto_secretbox()` | `mcrypt_*` (removed), `openssl_encrypt` with ECB |
| `hash_equals()` for comparison | `===` for hash comparison (timing attack) |
| HTTPS everywhere | HTTP for anything sensitive |

### Generating Tokens
```php
// Secure random token.
$token = bin2hex(random_bytes(32));

// Constant-time comparison.
if (! hash_equals($stored_token, $provided_token)) {
    throw new SecurityException('Invalid token');
}
```

## Laravel-Specific Security

```php
// Mass assignment protection — always define $fillable.
protected $fillable = ['name', 'email'];

// Encrypt sensitive data.
protected function casts(): array {
    return ['ssn' => 'encrypted'];
}

// Rate limiting.
Route::middleware('throttle:api')->group(function (): void {
    // Rate limited routes.
});

// Signed URLs for temporary access.
$url = URL::temporarySignedRoute('download', now()->addMinutes(30), ['file' => $id]);

// Validate signed URL.
if (! $request->hasValidSignature()) {
    abort(401);
}
```

## WordPress-Specific Security

```php
// Capability checks — always verify before action.
if (! current_user_can('manage_options')) {
    wp_die(__('Unauthorized.', 'rgbc'));
}

// Data validation with WordPress helpers.
$clean = [
    'title'   => sanitize_text_field($input['title']),
    'content' => wp_kses_post($input['content']),
    'email'   => sanitize_email($input['email']),
    'url'     => esc_url_raw($input['url']),
    'number'  => absint($input['number']),
    'file'    => sanitize_file_name($input['file']),
];

// Prevent direct file access.
if (! defined('ABSPATH')) {
    exit;
}

// Disable XML-RPC if not needed.
add_filter('xmlrpc_enabled', '__return_false');

// Disable file editing in admin.
define('DISALLOW_FILE_EDIT', true);
```

## Security Headers

```php
// Essential security headers (add via .htaccess, nginx, or PHP).
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('X-XSS-Protection: 0'); // Deprecated, CSP replaces it.
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
```

### Nginx Configuration
```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

# Block PHP in uploads.
location ~* /uploads/.*\.php$ {
    deny all;
}

# Hide sensitive files.
location ~ /\.(env|git|htaccess) {
    deny all;
}
```
