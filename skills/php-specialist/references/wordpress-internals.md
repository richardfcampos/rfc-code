# WordPress Internals & Best Practices

## Table of Contents
- [Hook System](#hook-system)
- [Database & WP_Query](#database--wp_query)
- [Custom Post Types & Taxonomies](#custom-post-types--taxonomies)
- [Gutenberg Blocks](#gutenberg-blocks)
- [REST API](#rest-api)
- [Security](#security)
- [Template Hierarchy](#template-hierarchy)
- [Performance](#performance)
- [Plugin Development](#plugin-development)
- [WP-CLI](#wp-cli)
- [Common Anti-Patterns](#common-anti-patterns)

## Hook System

### Actions (do something at a point)
```php
// Register: specify priority (default 10) and accepted args.
add_action('init', 'rgbc_register_post_types', 10, 0);
add_action('save_post', 'rgbc_clear_cache_on_save', 20, 2);

// Callback.
function rgbc_register_post_types(): void {
    register_post_type('brand', [ /* args */ ]);
}

// Fire custom action.
do_action('rgbc_after_brand_import', $brand_id, $data);
```

### Filters (transform data)
```php
// Modify output.
add_filter('the_content', 'rgbc_add_affiliate_links', 15, 1);
add_filter('wp_title', 'rgbc_custom_title', 10, 2);

// Filter callback — always return the filtered value.
function rgbc_add_affiliate_links(string $content): string {
    // Transform and return.
    return $content;
}

// Apply custom filter.
$output = apply_filters('rgbc_brand_display_name', $brand->post_title, $brand);
```

### Hook Priority & Order
- Lower number = runs earlier. Default is 10.
- Use priorities to control execution order between hooks.
- Late hooks (99, 999) for "last word" modifications.
- Early hooks (1, 5) for setup/initialization.

### Removing Hooks
```php
// Must match function, priority, and accepted args exactly.
remove_action('wp_head', 'wp_generator');
remove_filter('the_content', 'wpautop');
```

## Database & WP_Query

### WP_Query (always prefer over raw SQL)
```php
$query = new WP_Query([
    'post_type'      => 'brand',
    'posts_per_page' => 10,
    'post_status'    => 'publish',
    'meta_query'     => [
        [
            'key'     => 'rating',
            'value'   => 4,
            'compare' => '>=',
            'type'    => 'NUMERIC',
        ],
    ],
    'tax_query'      => [
        [
            'taxonomy' => 'sport',
            'field'    => 'slug',
            'terms'    => ['football', 'basketball'],
        ],
    ],
    'orderby'        => 'meta_value_num',
    'meta_key'       => 'rating',
    'order'          => 'DESC',
]);

while ($query->have_posts()) {
    $query->the_post();
    // Use template tags: the_title(), the_content(), etc.
}
wp_reset_postdata(); // Always reset after custom query.
```

### Direct Database (only when WP_Query can't do it)
```php
global $wpdb;

// ALWAYS use prepare() — never concatenate user input.
$results = $wpdb->get_results(
    $wpdb->prepare(
        "SELECT * FROM {$wpdb->posts} WHERE post_type = %s AND post_status = %s LIMIT %d",
        'brand',
        'publish',
        10
    )
);

// Insert with proper formatting.
$wpdb->insert(
    $wpdb->prefix . 'custom_table',
    [
        'user_id' => $user_id,
        'score'   => $score,
    ],
    ['%d', '%d']
);
```

### Transients (built-in cache)
```php
$data = get_transient('rgbc_top_brands');

if (false === $data) {
    $data = expensive_brand_query();
    set_transient('rgbc_top_brands', $data, HOUR_IN_SECONDS);
}

// Delete when data changes.
delete_transient('rgbc_top_brands');
```

## Custom Post Types & Taxonomies

### Register CPT
```php
function rgbc_register_brand_cpt(): void {
    $labels = [
        'name'          => __('Brands', 'rgbc'),
        'singular_name' => __('Brand', 'rgbc'),
        'add_new_item'  => __('Add New Brand', 'rgbc'),
        'edit_item'     => __('Edit Brand', 'rgbc'),
    ];

    register_post_type('brand', [
        'labels'       => $labels,
        'public'       => true,
        'has_archive'  => true,
        'show_in_rest' => true, // Required for Gutenberg.
        'supports'     => ['title', 'editor', 'thumbnail', 'excerpt', 'custom-fields'],
        'menu_icon'    => 'dashicons-star-filled',
        'rewrite'      => ['slug' => 'sportsbooks'],
        'capability_type' => 'post',
    ]);
}
add_action('init', 'rgbc_register_brand_cpt');
```

### Register Taxonomy
```php
function rgbc_register_sport_taxonomy(): void {
    register_taxonomy('sport', ['brand', 'news', 'event'], [
        'labels'       => [
            'name'          => __('Sports', 'rgbc'),
            'singular_name' => __('Sport', 'rgbc'),
        ],
        'hierarchical' => true,
        'public'       => true,
        'show_in_rest' => true,
        'rewrite'      => ['slug' => 'sport'],
    ]);
}
add_action('init', 'rgbc_register_sport_taxonomy');
```

## Gutenberg Blocks

### Block Structure (block.json + render.php)
```
blocks/my-block/
├── block.json       # Block metadata, attributes, supports.
├── edit.js          # Editor component (React).
├── save.js          # Frontend save (or null for dynamic).
├── render.php       # Server-side render (dynamic blocks).
├── editor.scss      # Editor-only styles.
├── style.scss       # Frontend + editor styles.
└── index.js         # Block registration entry point.
```

### block.json
```json
{
    "$schema": "https://schemas.wp.org/trunk/block.json",
    "apiVersion": 3,
    "name": "rgbc/brand-card",
    "title": "Brand Card",
    "category": "rgbc-blocks",
    "icon": "star-filled",
    "description": "Displays a sportsbook brand card.",
    "textdomain": "rgbc",
    "attributes": {
        "brandId": { "type": "number", "default": 0 },
        "showRating": { "type": "boolean", "default": true }
    },
    "supports": {
        "html": false,
        "align": ["wide", "full"]
    },
    "render": "file:./render.php",
    "editorScript": "file:./index.js",
    "editorStyle": "file:./editor.scss",
    "style": "file:./style.scss"
}
```

### Edit Component (React)
```jsx
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, ToggleControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

export default function Edit({ attributes, setAttributes }) {
    const { showRating } = attributes;
    const blockProps = useBlockProps();

    return (
        <>
            <InspectorControls>
                <PanelBody title={__('Settings', 'rgbc')}>
                    <ToggleControl
                        label={__('Show Rating', 'rgbc')}
                        checked={showRating}
                        onChange={(val) => setAttributes({ showRating: val })}
                    />
                </PanelBody>
            </InspectorControls>
            <div {...blockProps}>
                {/* Block preview */}
            </div>
        </>
    );
}
```

### Dynamic Render (render.php)
```php
<?php
/**
 * Brand Card block render.
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block content.
 * @var WP_Block $block      Block instance.
 */

$brand_id   = $attributes['brandId'] ?? 0;
$show_rating = $attributes['showRating'] ?? true;

if (! $brand_id) {
    return;
}

$brand = get_post($brand_id);

if (! $brand || 'publish' !== $brand->post_status) {
    return;
}

$wrapper = get_block_wrapper_attributes(['class' => 'brand-card']);
?>
<div <?php echo $wrapper; ?>>
    <h3 class="brand-card__title"><?php echo esc_html($brand->post_title); ?></h3>
    <?php if ($show_rating) : ?>
        <span class="brand-card__rating">
            <?php echo esc_html(get_field('rating', $brand_id)); ?>
        </span>
    <?php endif; ?>
</div>
```

## REST API

### Custom Endpoints
```php
add_action('rest_api_init', function (): void {
    register_rest_route('rgbc/v1', '/brands', [
        'methods'             => WP_REST_Server::READABLE,
        'callback'            => 'rgbc_get_brands',
        'permission_callback' => '__return_true', // Public endpoint.
        'args'                => [
            'sport' => [
                'type'              => 'string',
                'sanitize_callback' => 'sanitize_text_field',
            ],
            'per_page' => [
                'type'    => 'integer',
                'default' => 10,
                'minimum' => 1,
                'maximum' => 100,
            ],
        ],
    ]);
});

function rgbc_get_brands(WP_REST_Request $request): WP_REST_Response {
    $args = [
        'post_type'      => 'brand',
        'posts_per_page' => $request->get_param('per_page'),
        'post_status'    => 'publish',
    ];

    $sport = $request->get_param('sport');
    if ($sport) {
        $args['tax_query'] = [
            ['taxonomy' => 'sport', 'field' => 'slug', 'terms' => $sport],
        ];
    }

    $query = new WP_Query($args);

    return new WP_REST_Response([
        'brands' => array_map('rgbc_format_brand', $query->posts),
        'total'  => $query->found_posts,
    ]);
}
```

### Authenticated Endpoints
```php
register_rest_route('rgbc/v1', '/brands/(?P<id>\d+)', [
    'methods'             => WP_REST_Server::EDITABLE,
    'callback'            => 'rgbc_update_brand',
    'permission_callback' => function (WP_REST_Request $request): bool {
        return current_user_can('edit_post', $request->get_param('id'));
    },
    'args' => [
        'id' => [
            'validate_callback' => function ($value): bool {
                return is_numeric($value) && $value > 0;
            },
        ],
    ],
]);
```

## Security

### Output Escaping (always escape, never trust)
```php
// HTML content.
echo esc_html($title);

// HTML attributes.
echo '<div class="' . esc_attr($class) . '">';

// URLs.
echo '<a href="' . esc_url($link) . '">';

// JavaScript in HTML.
echo '<script>var data = ' . wp_json_encode($data) . ';</script>';

// Allow specific HTML (e.g., from editor).
echo wp_kses_post($content);

// Custom allowed HTML.
echo wp_kses($content, [
    'a'      => ['href' => [], 'title' => [], 'class' => []],
    'strong' => [],
    'em'     => [],
]);
```

### Input Sanitization
```php
$title  = sanitize_text_field(wp_unslash($_POST['title'] ?? ''));
$email  = sanitize_email($_POST['email'] ?? '');
$url    = esc_url_raw($_POST['url'] ?? '');
$int    = absint($_POST['count'] ?? 0);
$html   = wp_kses_post(wp_unslash($_POST['content'] ?? ''));
```

### Nonce Verification
```php
// In form.
wp_nonce_field('rgbc_save_settings', 'rgbc_nonce');

// On submit.
if (! isset($_POST['rgbc_nonce']) || ! wp_verify_nonce(
    sanitize_text_field(wp_unslash($_POST['rgbc_nonce'])),
    'rgbc_save_settings'
)) {
    wp_die(__('Security check failed.', 'rgbc'));
}

// AJAX nonce.
add_action('wp_ajax_rgbc_action', function (): void {
    check_ajax_referer('rgbc_ajax_nonce', 'nonce');
    // Process...
    wp_send_json_success($data);
});
```

## Template Hierarchy

Lookup order (WordPress loads the first match):
1. `page-{slug}.php` / `single-{post_type}-{slug}.php`
2. `page-{id}.php` / `single-{post_type}.php`
3. `page.php` / `single.php`
4. `singular.php`
5. `index.php`

For archives: `archive-{post_type}.php` → `archive.php` → `index.php`.
For taxonomies: `taxonomy-{taxonomy}-{term}.php` → `taxonomy-{taxonomy}.php` → `taxonomy.php`.

### Template Parts
```php
// Load a partial with data.
get_template_part('partials/brand', 'card', [
    'brand_id'   => $brand->ID,
    'show_rating' => true,
]);

// In partials/brand-card.php:
$brand_id    = $args['brand_id'] ?? 0;
$show_rating = $args['show_rating'] ?? false;
```

## Performance

### Enqueue Assets Properly
```php
add_action('wp_enqueue_scripts', function (): void {
    // Conditional loading — only load where needed.
    if (is_singular('brand')) {
        wp_enqueue_style(
            'rgbc-brand',
            get_theme_file_uri('build/brand.css'),
            [],
            filemtime(get_theme_file_path('build/brand.css'))
        );
    }

    // Defer non-critical JS.
    wp_enqueue_script(
        'rgbc-analytics',
        get_theme_file_uri('build/analytics.js'),
        [],
        filemtime(get_theme_file_path('build/analytics.js')),
        ['strategy' => 'defer']
    );
});
```

### Object Cache (Redis)
```php
// Use wp_cache for frequently accessed data.
$brands = wp_cache_get('top_brands', 'rgbc');

if (false === $brands) {
    $brands = get_top_brands_query();
    wp_cache_set('top_brands', $brands, 'rgbc', 3600);
}
```

### Query Optimization
- Use `'fields' => 'ids'` when you only need IDs.
- Use `'no_found_rows' => true` when pagination isn't needed.
- Use `'update_post_meta_cache' => false` when meta isn't needed.
- Use `'update_post_term_cache' => false` when terms aren't needed.

```php
$ids = new WP_Query([
    'post_type'      => 'brand',
    'posts_per_page' => 100,
    'fields'         => 'ids',
    'no_found_rows'  => true,
    'update_post_meta_cache' => false,
    'update_post_term_cache' => false,
]);
```

## Plugin Development

### Plugin Header & Bootstrap
```php
<?php
/**
 * Plugin Name: RGBC Feature
 * Description: Custom feature plugin.
 * Version:     1.0.0
 * Author:      RGBCode
 * Text Domain: rgbc
 * Requires PHP: 8.4
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

define('RGBC_FEATURE_PATH', plugin_dir_path(__FILE__));
define('RGBC_FEATURE_URL', plugin_dir_url(__FILE__));

require_once RGBC_FEATURE_PATH . 'includes/class-main.php';

add_action('plugins_loaded', [RGBC\Feature\Main::class, 'init']);
```

### Activation / Deactivation
```php
register_activation_hook(__FILE__, function (): void {
    // Create tables, set default options, flush rewrite rules.
    flush_rewrite_rules();
});

register_deactivation_hook(__FILE__, function (): void {
    // Clean up scheduled events.
    wp_clear_scheduled_hook('rgbc_daily_sync');
});
```

## WP-CLI

### Custom Commands
```php
if (defined('WP_CLI') && WP_CLI) {
    WP_CLI::add_command('rgbc sync-brands', function (array $args, array $assoc_args): void {
        $dry_run = WP_CLI\Utils\get_flag_value($assoc_args, 'dry-run', false);

        $brands = fetch_brands_from_api();
        $progress = WP_CLI\Utils\make_progress_bar('Syncing brands', count($brands));

        foreach ($brands as $brand) {
            if (! $dry_run) {
                sync_brand($brand);
            }
            $progress->tick();
        }

        $progress->finish();
        WP_CLI::success(sprintf('Synced %d brands.', count($brands)));
    });
}
```

## Common Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| Direct `$_GET`/`$_POST` | No sanitization | Use `sanitize_*()` + `wp_unslash()` |
| `echo $variable` | XSS vulnerability | Always `esc_html()`, `esc_attr()`, etc. |
| `query_posts()` | Modifies main query | Use `WP_Query` or `pre_get_posts` |
| Missing `wp_reset_postdata()` | Corrupts global `$post` | Always reset after custom queries |
| `wp_enqueue_script` without deps | Race conditions | Declare dependencies array |
| Loading all assets everywhere | Performance waste | Conditional loading with `is_*()` |
| Hardcoded strings | Not translatable | Use `__()`, `_e()`, `esc_html__()` |
| `update_option` in loop | N queries | Batch or use transients |
| No capability checks | Unauthorized access | `current_user_can()` before actions |
| `$wpdb->query()` without prepare | SQL injection | Always use `$wpdb->prepare()` |
