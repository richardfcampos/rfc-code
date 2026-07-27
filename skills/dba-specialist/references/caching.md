# Caching Strategies

## Table of Contents
- [Caching Fundamentals](#caching-fundamentals)
- [Redis Caching Patterns](#redis-caching-patterns)
- [Application-Level Caching](#application-level-caching)
- [Cache Invalidation](#cache-invalidation)
- [Database-Level Caching](#database-level-caching)
- [CDN & HTTP Caching](#cdn--http-caching)
- [Cache Architecture](#cache-architecture)

## Caching Fundamentals

### Cache Hierarchy
| Layer | Latency | Scope | Use For |
|-------|---------|-------|---------|
| CPU L1/L2/L3 | ~1-10ns | Process | Automatic |
| Application memory | ~100ns | Process | Hot objects, computed values |
| Redis / Memcached | ~0.5-1ms | Distributed | Sessions, API responses, objects |
| Database query cache | ~1-5ms | Database | Repeated identical queries |
| Database buffer pool | ~0.1ms | Database | Frequently accessed pages |
| CDN / HTTP cache | ~5-50ms | Global | Static assets, API responses |
| Full-page cache | ~1-5ms | Application | Rendered pages |

### When to Cache
- **Cache**: Expensive queries, API responses, computed values, session data, configuration.
- **Don't cache**: Highly personalized real-time data, frequently changing data with low read-to-write ratio, security-sensitive data (tokens, credentials).

### Key Metrics
| Metric | Target | Meaning |
|--------|--------|---------|
| Hit ratio | > 95% | % of requests served from cache |
| Miss penalty | < 100ms | Time to populate cache on miss |
| TTL | Varies | Balance freshness vs hit ratio |
| Eviction rate | < 1% | % of keys evicted (memory pressure) |

## Redis Caching Patterns

### Cache-Aside (Lazy Loading)
```php
// Most common pattern. Application manages cache.
function getUser(int $id): array {
    $key = "user:{$id}";

    // 1. Check cache.
    $cached = Redis::get($key);
    if ($cached !== null) {
        return json_decode($cached, true);
    }

    // 2. Cache miss — query DB.
    $user = DB::table('users')->find($id);

    // 3. Populate cache.
    Redis::setex($key, 3600, json_encode($user));

    return $user;
}
```
**Pros**: Only caches what's requested, handles cache failures gracefully.
**Cons**: Cache miss = slow first request, potential stale data.

### Write-Through
```php
// Write to cache AND database simultaneously.
function updateUser(int $id, array $data): void {
    // 1. Update database.
    DB::table('users')->where('id', $id)->update($data);

    // 2. Update cache immediately.
    $user = DB::table('users')->find($id);
    Redis::setex("user:{$id}", 3600, json_encode($user));
}
```
**Pros**: Cache always fresh. No stale reads.
**Cons**: Write latency (both cache + DB). Caches data that may never be read.

### Write-Behind (Write-Back)
```php
// Write to cache first, async write to DB.
function recordPageView(int $pageId): void {
    // Increment in Redis (fast).
    Redis::incr("pageviews:{$pageId}");
}

// Periodic flush to database (cron/job).
function flushPageViews(): void {
    $keys = Redis::keys('pageviews:*');
    foreach ($keys as $key) {
        $pageId = str_replace('pageviews:', '', $key);
        $count = Redis::getdel($key);
        DB::table('pages')->where('id', $pageId)
            ->increment('views', $count);
    }
}
```
**Pros**: Fastest writes. Batches DB writes.
**Cons**: Data loss risk if cache fails before flush. Complexity.

### Cache Stampede Prevention
```php
// Problem: many requests hit cache miss simultaneously, all query DB.

// Solution 1: Locking.
function getUserWithLock(int $id): array {
    $key = "user:{$id}";
    $lockKey = "lock:user:{$id}";

    $cached = Redis::get($key);
    if ($cached !== null) {
        return json_decode($cached, true);
    }

    // Acquire lock.
    $acquired = Redis::set($lockKey, 1, 'NX', 'EX', 5);
    if (!$acquired) {
        usleep(100000); // Wait 100ms, retry.
        return getUserWithLock($id);
    }

    $user = DB::table('users')->find($id);
    Redis::setex($key, 3600, json_encode($user));
    Redis::del($lockKey);

    return $user;
}

// Solution 2: Probabilistic early expiration.
// Refresh cache before TTL expires with some probability.
function getUserEarlyRefresh(int $id): array {
    $key = "user:{$id}";
    $ttl = Redis::ttl($key);
    $cached = Redis::get($key);

    // If TTL < 5 minutes and random chance, refresh proactively.
    if ($cached !== null && $ttl > 300) {
        return json_decode($cached, true);
    }

    if ($cached !== null && random_int(1, 10) > 1) {
        return json_decode($cached, true); // 90% still use cache.
    }

    // Refresh.
    $user = DB::table('users')->find($id);
    Redis::setex($key, 3600, json_encode($user));
    return $user;
}
```

### Key Design Patterns
```
# Naming convention: entity:id:attribute.
user:123                    # Full user object.
user:123:orders             # User's order list.
user:123:settings           # User settings.
brand:456:rating            # Specific attribute.

# Namespace by environment.
prod:user:123
staging:user:123

# Versioned keys (for schema changes).
user:v2:123

# Hash for related fields (saves memory).
HSET user:123 name "John" email "john@x.com" role "admin"
HGET user:123 name
HGETALL user:123
```

## Application-Level Caching

### Laravel Cache
```php
// Simple remember pattern.
$user = Cache::remember("user:{$id}", 3600, function () use ($id) {
    return User::with('profile')->find($id);
});

// Tagged cache (group invalidation).
$brands = Cache::tags(['brands', 'homepage'])->remember('top_brands', 3600, function () {
    return Brand::topRated()->limit(10)->get();
});

// Invalidate by tag.
Cache::tags(['brands'])->flush();

// Atomic locks.
$lock = Cache::lock("processing:order:{$id}", 10);
if ($lock->get()) {
    try {
        processOrder($id);
    } finally {
        $lock->release();
    }
}
```

### WordPress Caching
```php
// Transients (database-backed, Redis if object cache active).
$brands = get_transient('top_brands');
if (false === $brands) {
    $brands = expensive_query();
    set_transient('top_brands', $brands, HOUR_IN_SECONDS);
}

// Object cache (Redis/Memcached — per-request by default, persistent with plugin).
$data = wp_cache_get('key', 'group');
if (false === $data) {
    $data = expensive_computation();
    wp_cache_set('key', $data, 'group', 3600);
}

// Fragment caching.
$fragment = wp_cache_get('sidebar_widget', 'fragments');
if (false === $fragment) {
    ob_start();
    render_expensive_widget();
    $fragment = ob_get_clean();
    wp_cache_set('sidebar_widget', $fragment, 'fragments', 3600);
}
echo $fragment;
```

## Cache Invalidation

### Strategies
| Strategy | Freshness | Complexity | Use When |
|----------|-----------|------------|----------|
| TTL-based | Eventual | Low | OK with slight staleness |
| Event-driven | Immediate | Medium | Must be fresh after writes |
| Version-based | Immediate | Low | Cache key includes version |
| Tag-based | Immediate | Medium | Group invalidation needed |

### Event-Driven Invalidation
```php
// Laravel: invalidate on model events.
class User extends Model
{
    protected static function booted(): void
    {
        static::saved(function (User $user): void {
            Cache::forget("user:{$user->id}");
            Cache::tags(['users'])->flush();
        });

        static::deleted(function (User $user): void {
            Cache::forget("user:{$user->id}");
        });
    }
}

// WordPress: invalidate on post save.
add_action('save_post_brand', function (int $post_id): void {
    delete_transient('top_brands');
    delete_transient("brand_{$post_id}");
    wp_cache_delete('top_brands', 'brands');
});
```

### Version-Based (Cache Busting)
```php
// Increment version on data change.
function invalidateBrandsCache(): void {
    Redis::incr('brands:version');
}

function getTopBrands(): array {
    $version = Redis::get('brands:version') ?? 0;
    $key = "top_brands:v{$version}";

    return Cache::remember($key, 3600, function () {
        return Brand::topRated()->get();
    });
}
```

## Database-Level Caching

### MySQL InnoDB Buffer Pool
```ini
# Cache data and index pages in memory.
innodb_buffer_pool_size = 12G    # 70-80% of RAM for dedicated DB server.
innodb_buffer_pool_instances = 8  # Reduce contention.

# Monitor hit ratio.
# SHOW STATUS LIKE 'Innodb_buffer_pool_read%';
# Hit ratio = 1 - (reads / read_requests). Target > 99%.
```

### PostgreSQL Shared Buffers
```ini
shared_buffers = 4GB              # 25% of RAM.
effective_cache_size = 12GB        # 75% of RAM (includes OS cache).

# Monitor.
# SELECT sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)) FROM pg_statio_user_tables;
```

### Query Result Caching
```sql
-- PostgreSQL: materialized views as query cache.
CREATE MATERIALIZED VIEW brand_stats AS
SELECT brand_id, COUNT(*) AS review_count, AVG(rating) AS avg_rating
FROM reviews GROUP BY brand_id;

-- Refresh periodically.
REFRESH MATERIALIZED VIEW CONCURRENTLY brand_stats;

-- MySQL 8.0+: no query cache. Use application cache instead.
-- MariaDB: query_cache_type = ON (for simple workloads).
```

## CDN & HTTP Caching

### Cache-Control Headers
```
# Static assets: long cache with hashed filenames.
Cache-Control: public, max-age=31536000, immutable

# API responses: short cache with revalidation.
Cache-Control: public, max-age=60, stale-while-revalidate=30

# Private user data: no shared cache.
Cache-Control: private, no-cache

# Never cache.
Cache-Control: no-store
```

### API Response Caching
```php
// Laravel: cache API responses.
Route::get('/api/brands', function () {
    return Cache::remember('api:brands', 300, function () {
        return BrandResource::collection(Brand::active()->get());
    });
})->middleware('cache.headers:public;max_age=300');
```

## Cache Architecture

### Multi-Layer Strategy
```
Request → CDN (static) → App Cache (Redis) → DB Query Cache → Database

Layer 1: CDN / Reverse Proxy (Varnish, CloudFront)
  - Full-page cache for anonymous pages.
  - Static asset caching.

Layer 2: Application Cache (Redis)
  - Object cache (serialized models).
  - Fragment cache (HTML partials).
  - Session storage.
  - Rate limiting counters.

Layer 3: Database Cache
  - Buffer pool / shared buffers.
  - Materialized views.
  - Query plan cache.
```

### Redis vs Memcached
| Feature | Redis | Memcached |
|---------|-------|-----------|
| Data structures | Rich (lists, sets, sorted sets, streams) | String only |
| Persistence | RDB + AOF | None |
| Replication | Yes (primary-replica) | No |
| Clustering | Redis Cluster | Client-side |
| Pub/Sub | Yes | No |
| Scripting | Lua | No |
| Memory efficiency | Lower (overhead per key) | Higher |
| Multi-threaded | io-threads (6.0+) | Yes (native) |
| Best for | General purpose | Simple KV cache |

**Recommendation**: Use Redis unless you need Memcached's multi-threaded performance for simple key-value caching with very high throughput.
