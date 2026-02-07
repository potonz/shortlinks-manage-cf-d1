# Short Links Manager

A monorepo for a flexible short links manager system that provides functionality for creating, managing, and resolving short URLs. This project consists of two main packages:

| Package                                                                               | Description                                                       |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [@potonz/shortlinks-manager](./packages/shortlinks-manager)                           | The core package that provides the logic for managing short links |
| [@potonz/shortlinks-manager-cf-d1](./packages/shortlinks-manager-cloudflare-d1)       | A Cloudflare D1 database backend for the core package             |
| [@potonz/shortlinks-manager-postgres](./packages/shortlinks-manager-postgres)         | A PostgreSQL database backend using postgres.js                   |

## 🚀 Features

- **Short Link Generation**: Creates unique short IDs with collision handling
- **Caching Support**: Built-in caching layer to improve performance
- **Backend Abstraction**: Flexible backend interface for different storage systems
- **Cloudflare D1 Support**: Database backend implementation for Cloudflare D1
- **PostgreSQL Support**: Database backend implementation for PostgreSQL using postgres.js
- **Automatic Cleanup**: Removes unused links based on age criteria
- **Last Accessed Tracking**: Tracks when links were last accessed for cleanup purposes
- **Type Safety**: Full TypeScript support with strict typing

## 🚀 Quick Start

### Using Cloudflare D1 Backend and KV cache

```typescript
import { createManager, type ICache } from "@potonz/shotlinks-manager";
import { createD1Backend } from "@potonz/shortlinks-manager-cf-d1";

interface Env {
    DB: D1Database;
    CACHE: KVNamespace;
}

class KvCache implements ICache {
    /** Implements KV functions */
}

// In a Cloudflare Worker
export default {
    async fetch(request: Request, env: Env) {
        const backend = createD1Backend(env.DB);
        // Initialize database tables
        await backend.setupTables();

        // Use with manager
        const manager = await createManager({
            backend,
            caches: [new KvCache()],
            shortIdLength: 6,
            onShortIdLengthUpdated: (newLength) => {
                // Handle length updates
            },
        });

        // Your routing logic here
    },
};
```

### Using PostgreSQL Backend

```typescript
import { createManager } from "@potonz/shortlinks-manager";
import { createPostgresBackend } from "@potonz/shortlinks-manager-postgres";

// Connection URI format: postgres://user:password@host:port/database
const connectionUri = "postgres://user:password@localhost:5432/shortlinks";
const backend = createPostgresBackend(connectionUri);

// Initialize database tables (call once)
await backend.setupTables();

// Use with manager
const manager = await createManager({
    backend,
    shortIdLength: 6,
    onShortIdLengthUpdated: (newLength) => {
        // Handle length updates
    },
});

// Create a short link
const shortId = await manager.createShortLink("https://example.com");

// Resolve a short link
const targetUrl = await manager.getTargetUrl(shortId);
```

## 📦 Installation

Install the packages in your project:

```bash
# For core functionality
bun add @potonz/shortlinks-manager

# For Cloudflare D1 support
bun add @potonz/shortlinks-manager-cf-d1

# For PostgreSQL support
bun add @potonz/shortlinks-manager-postgres
```

## 📪 Database Structure

The shortlinks-manager uses two tables: `sl_base_urls` for managing base URL configurations and `sl_links_map` for storing short link mappings. This structure is designed to be compatible with most SQL databases.

### Table: `sl_base_urls`

Stores base URL configurations for multi-tenant scenarios.

| Column | Type | Constraint | Description |
|--------|------|------------|-------------|
| `id` | INTEGER | PRIMARY KEY, AUTOINCREMENT | Unique identifier for the base URL |
| `base_url` | VARCHAR(255) | NOT NULL, UNIQUE | The base URL (e.g., "https://example.com") |
| `is_active` | INTEGER/BOOLEAN | DEFAULT 1 | Whether the base URL is active |
| `created_at` | DATETIME/TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Timestamp when the record was created |

### Table: `sl_links_map`

Stores the short link mappings.

| Column | Type | Constraint | Description |
|--------|------|------------|-------------|
| `id` | INTEGER | PRIMARY KEY, AUTOINCREMENT | Unique identifier for the link |
| `short_id` | VARCHAR(255) | NOT NULL | Unique identifier for the short link |
| `target_url` | VARCHAR(65535)/TEXT | NOT NULL | The target URL to redirect to |
| `base_url_id` | INTEGER | NULL, FOREIGN KEY | References `sl_base_urls(id)` or NULL for default |
| `last_accessed_at` | DATETIME/TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Timestamp of the last access |
| `created_at` | DATETIME/TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Timestamp when the link was created |

**Constraints:**
- `UNIQUE (short_id, base_url_id)` - Ensures uniqueness within a base URL context
- `FOREIGN KEY (base_url_id) REFERENCES sl_base_urls(id) ON DELETE SET NULL`

### Indexes

| Name | Columns | Purpose |
|------|---------|---------|
| `idx_sl_links_map_last_accessed_at` | `last_accessed_at` | Optimizes queries for cleaning unused links |
| `idx_sl_links_map_base_url_id` | `base_url_id` | Optimizes lookups by base URL |
| `idx_sl_links_map_short_id_base_url` | `short_id, base_url_id` | Optimizes lookups by short ID and base URL |

**Notes:**
- `VARCHAR(65535)` is used for the target URL to allow long URLs (adjust based on your DBMS limitations)
- `TIMESTAMP` or `DATETIME` type may vary by database; use the appropriate type for your DBMS
- The `base_url_id` can be NULL for links that don't belong to a specific base URL
- The indexes optimize various query patterns including lookups and cleanup operations

## 🏗️ Development

### Commands

- `bun run build`: Build all packages
- `bun run lint`: Run ESLint
- `bun run lint:fix`: Run ESLint with auto-fix
- `bun test`: Run tests

## 📝 Environment Requirements

- **Bun**: Required for development and build processes
- **Cloudflare Wrangler**: For Cloudflare D1 development and deployment
- **postgres.js**: For PostgreSQL backend (installed automatically with the postgres package)

## 🤝 Contributing

Contributions are always welcome to improve the core or add more backends support!

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.
