# Performance Optimization

## Table of Contents
- [PHP Performance](#php-performance)
- [Database Optimization](#database-optimization)
- [Caching Strategies](#caching-strategies)
- [Laravel Performance](#laravel-performance)
- [WordPress Performance](#wordpress-performance)
- [Frontend & Asset Optimization](#frontend--asset-optimization)
- [Profiling & Debugging](#profiling--debugging)

## PHP Performance

### OPcache (mandatory in production)
```ini
; php.ini — always enable OPcache.
opcache.enable=1
opcache.memory_consumption=256
opcache.max_accelerated_files=20000
opcache.validate_timestamps=0         ; Disable in production (deploy clears cache).
opcache.jit=1255                      ; Enable JIT (PHP 8.0+).
opcache.jit_buffer_size=128M
```

### Memory-Efficient Patterns
```php
// Generators for large datasets — constant memory usage.
function readLines(string $path): Generator {
    $handle = fopen($path, 'r');
    while (($line = fgets($handle)) !== false) {
        yield trim($line);
    }
    fclose($handle);
}

// Process chunk by chunk — don't load everything.
foreach (readLines('/large/file.csv') as $line) {
    processLine($line);
}

// Unset large variables when done.
$data = processLargeDataset();
$result = transformData($data);
unset($data); // Free memory before next operation.
```

### String & Array Performance
```php
// Prefer specific functions over regex when possible.
str_contains($haystack, $needle);       // Not preg_match.
str_starts_with($url, 'https://');      // Not substr($url, 0, 8).
str_ends_with($file, '.php');           // Not preg_match('/\.php$/', $file).

// Array performance.
$lookup = array_flip($values);          // O(1) lookup with isset.
isset($lookup[$needle]);                // Instead of in_array (O(n)).

// Avoid array_merge in loops.
$result = [];
foreach ($batches as $batch) {
    array_push($result, ...$batch);     // Instead of $result = array_merge($result, $batch).
}

// Use SplFixedArray for large fixed-size arrays.
$arr = new SplFixedArray(1000000);      // 50% less memory than regular array.
```

### Function Call Optimization
```php
// Cache method results in local variables.
$count = count($items);                 // Don't call count() in loop condition.
for ($i = 0; $i < $count; $i++) {
    // Process $items[$i].
}

// Avoid repeated property access.
$connection = $this->database->getConnection();
$result1 = $connection->query($sql1);
$result2 = $connection->query($sql2);
```

## Database Optimization

### Indexing Strategy
```sql
-- Index columns used in WHERE, JOIN, ORDER BY.
CREATE INDEX idx_posts_status_date ON posts (status, created_at);

-- Covering index: query served entirely from index.
CREATE INDEX idx_users_email_name ON users (email, name);

-- Partial index (PostgreSQL) or filtered index.
CREATE INDEX idx_active_users ON users (email) WHERE status = 'active';
```

### Query Patterns
```php
// Batch inserts — not one at a time.
// Bad: N queries.
foreach ($items as $item) {
    DB::table('items')->insert($item);
}

// Good: 1 query.
DB::table('items')->insert($items);

// Use EXPLAIN to analyze queries.
DB::enableQueryLog();
// ... run queries ...
$queries = DB::getQueryLog();

// Paginate large results — never SELECT *.
$page = DB::table('orders')
    ->select(['id', 'status', 'total'])
    ->where('status', 'active')
    ->orderBy('created_at', 'desc')
    ->cursorPaginate(50);  // Cursor pagination for large tables.
```

### N+1 Query Prevention
```php
// Problem: 1 query + N queries for each relationship.
$orders = Order::all();
foreach ($orders as $order) {
    echo $order->user->name; // N additional queries.
}

// Solution: eager load.
$orders = Order::with('user')->get();

// Nested eager loading.
$orders = Order::with(['user', 'items.product'])->get();

// Lazy eager loading (when you already have the collection).
$orders->load('user');

// Prevent in development.
Model::preventLazyLoading(! app()->isProduction());
```

## Caching Strategies

### Cache Layers
| Layer | Speed | Scope | Use For |
|-------|-------|-------|---------|
| OPcache | Fastest | PHP files | Compiled PHP bytecode |
| APCu | Very fast | Single server | Small key-value data |
| Redis/Memcached | Fast | Distributed | Sessions, objects, full-page |
| HTTP cache | Fast | CDN/Browser | Static assets, API responses |
| Database query cache | Moderate | Application | Expensive query results |

### Redis Caching Patterns
```php
// Cache-aside pattern.
function getUser(int $id): User {
    $key = "user:{$id}";
    $cached = Redis::get($key);

    if ($cached !== null) {
        return unserialize($cached);
    }

    $user = User::findOrFail($id);
    Redis::setex($key, 3600, serialize($user));

    return $user;
}

// Cache invalidation on update.
function updateUser(int $id, array $data): User {
    $user = User::findOrFail($id);
    $user->update($data);

    Redis::del("user:{$id}");
    Redis::del("user:list"); // Invalidate related caches.

    return $user;
}

// Tag-based invalidation (Laravel).
Cache::tags(['users'])->put("user:{$id}", $user, 3600);
Cache::tags(['users'])->flush(); // Invalidate all user caches.
```

### Cache Key Strategies
```php
// Include version for cache busting.
$key = "brands:v2:sport:{$sport}:page:{$page}";

// Include relevant parameters.
$key = sprintf('api:brands:%s', md5(serialize($params)));

// Use cache tags for group invalidation.
Cache::tags(['brands', "sport:{$sport}"])->remember($key, 3600, fn () => $query);
```

## Laravel Performance

### Route Caching
```bash
# Production: always cache routes and config.
php artisan route:cache
php artisan config:cache
php artisan view:cache
php artisan event:cache

# Development: clear caches.
php artisan optimize:clear
```

### Eloquent Optimization
```php
// Use toBase() when you don't need models.
$totals = Order::query()
    ->select(DB::raw('status, COUNT(*) as count'))
    ->groupBy('status')
    ->toBase()                  // Returns stdClass, not Eloquent models.
    ->get();

// Use chunk for batch processing.
User::where('active', true)->chunk(500, function ($users): void {
    foreach ($users as $user) {
        // Process without loading all users into memory.
    }
});

// Use lazy() for even more memory efficiency.
User::where('active', true)->lazy()->each(function (User $user): void {
    // Processes one at a time using generators.
});
```

### Queue Optimization
```php
// Use ShouldBeUnique to prevent duplicate jobs.
class ProcessOrder implements ShouldQueue, ShouldBeUnique
{
    public int $uniqueFor = 3600;

    public function uniqueId(): string
    {
        return (string) $this->orderId;
    }
}

// Use job batching for parallel processing.
Bus::batch($jobs)
    ->then(fn () => Log::info('All done'))
    ->catch(fn () => Log::error('Batch failed'))
    ->allowFailures()
    ->dispatch();

// Rate limit jobs.
Redis::throttle('api-calls')->allow(100)->every(60)->then(function (): void {
    // Process job.
}, function (): static {
    return $this->release(30); // Retry after 30 seconds.
});
```

## WordPress Performance

### Query Optimization Flags
```php
$query = new WP_Query([
    'post_type'      => 'brand',
    'posts_per_page' => 10,
    'no_found_rows'  => true,              // Skip COUNT(*) for total — saves query when pagination not needed.
    'update_post_meta_cache' => false,      // Skip meta preloading.
    'update_post_term_cache' => false,      // Skip term preloading.
    'fields'         => 'ids',             // Only fetch IDs — fastest.
]);
```

### Transient Patterns
```php
// Time-based cache for expensive operations.
function rgbc_get_featured_brands(): array {
    $key = 'rgbc_featured_brands';
    $brands = get_transient($key);

    if (false !== $brands) {
        return $brands;
    }

    $brands = expensive_brand_query();
    set_transient($key, $brands, 12 * HOUR_IN_SECONDS);

    return $brands;
}

// Invalidate on content change.
add_action('save_post_brand', function (int $post_id): void {
    delete_transient('rgbc_featured_brands');
    delete_transient("rgbc_brand_{$post_id}");
});
```

### Object Cache (Redis)
```php
// Group-based caching.
wp_cache_set('key', $data, 'rgbc_brands', 3600);
$data = wp_cache_get('key', 'rgbc_brands');

// Non-persistent groups — per-request only.
wp_cache_add_non_persistent_groups(['rgbc_request']);
```

### Asset Loading
```php
// Load assets only where needed.
add_action('wp_enqueue_scripts', function (): void {
    if (is_singular('brand')) {
        wp_enqueue_script('rgbc-brand', ...);
        wp_enqueue_style('rgbc-brand', ...);
    }
});

// Defer non-critical scripts.
wp_enqueue_script('rgbc-analytics', $url, [], $ver, [
    'strategy' => 'defer',
    'in_footer' => true,
]);

// Preload critical assets.
add_action('wp_head', function (): void {
    echo '<link rel="preload" href="' . esc_url(get_theme_file_uri('build/critical.css')) . '" as="style">';
});
```

## Frontend & Asset Optimization

### Image Optimization
- Serve WebP/AVIF with fallbacks.
- Use `loading="lazy"` for below-the-fold images.
- Use `srcset` and `sizes` for responsive images.
- Specify `width` and `height` to prevent layout shift.

### Critical CSS
- Inline critical above-the-fold CSS.
- Defer non-critical stylesheets.
- Use `preload` for important resources.

### JavaScript
- Code split by route/page.
- Tree shake unused code.
- Defer non-essential scripts.
- Use `async` for independent scripts.

## Profiling & Debugging

### Tools
| Tool | Environment | Use For |
|------|-------------|---------|
| Xdebug profiler | Local | Function-level profiling |
| Blackfire | Local/Staging | Performance profiling + recommendations |
| Query Monitor | WordPress local | Database query analysis |
| Laravel Telescope | Laravel local | Request/query/job inspection |
| Laravel Debugbar | Laravel local | In-page profiling toolbar |
| `EXPLAIN` | Any | SQL query analysis |
| OPcache status | Production | Verify OPcache is working |

### Quick Profiling
```php
// Measure execution time.
$start = microtime(true);
// ... code to profile ...
$elapsed = microtime(true) - $start;
error_log(sprintf('Operation took %.4f seconds', $elapsed));

// Memory usage.
$memBefore = memory_get_usage(true);
// ... operation ...
$memAfter = memory_get_usage(true);
error_log(sprintf('Memory delta: %s', formatBytes($memAfter - $memBefore)));
```

### Laravel Query Logging
```php
DB::enableQueryLog();
// ... operations ...
$queries = DB::getQueryLog();
foreach ($queries as $query) {
    Log::debug($query['query'], ['bindings' => $query['bindings'], 'time' => $query['time']]);
}
```

### WordPress Query Debugging
```php
// Add to wp-config.php for development.
define('SAVEQUERIES', true);

// Then inspect.
global $wpdb;
echo '<pre>' . esc_html(print_r($wpdb->queries, true)) . '</pre>';
// Shows query, caller, and time for each query.
```
