# @potonz/shortlinks-manager-postgres

PostgreSQL backend for short links manager using [postgres.js](https://github.com/porsager/postgres).

## Features

- Full PostgreSQL support with prepared statements via postgres.js
- Automatic table creation and indexing
- Support for PostgreSQL 14, 15, 16, 17, and 18
- Type-safe SQL with tagged template literals
- Efficient parameterized queries

## Installation

```bash
bun add @potonz/shortlinks-manager-postgres
```

## Usage

```typescript
import { createManager } from "@potonz/shortlinks-manager";
import { createPostgresBackend } from "@potonz/shortlinks-manager-postgres";

// Create backend with connection URI
const backend = createPostgresBackend("postgres://user:password@localhost:5432/shortlinks");

// Initialize tables (run once during setup)
await backend.setupTables();

// Create manager
const manager = await createManager({
    backend,
    shortIdLength: 6,
    onShortIdLengthUpdated: (newLength) => {
        console.log(`Short ID length updated to ${newLength}`);
    },
});

// Create short link
const shortId = await manager.createShortLink("https://example.com");
console.log(`Created short link: ${shortId}`);

// Resolve short link
const targetUrl = await manager.getTargetUrl(shortId);
console.log(`Target URL: ${targetUrl}`);
```

## Database Schema

The backend automatically creates the following table:

```sql
CREATE TABLE IF NOT EXISTS sl_links_map (
    short_id VARCHAR(255) NOT NULL PRIMARY KEY,
    target_url TEXT NOT NULL,
    last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sl_links_map_last_accessed_at 
ON sl_links_map(last_accessed_at);
```

## API

### `createPostgresBackend(connectionUri: string)`

Creates a PostgreSQL backend instance.

**Parameters:**
- `connectionUri` - PostgreSQL connection URI (e.g., `postgres://user:password@localhost:5432/dbname`)

**Returns:** `IShortLinksManagerPostgresBackend`

### `backend.setupTables()`

Creates the required database tables and indexes. Should be called once during application initialization.

### Backend Methods

Implements all `IShortLinksManagerBackend` methods:

- `getTargetUrl(shortId)` - Get target URL by short ID
- `createShortLink(shortId, targetUrl)` - Create a new short link
- `checkShortIdsExist(shortIds)` - Check which short IDs already exist
- `updateShortLinkLastAccessTime(shortId, time)` - Update last accessed timestamp
- `cleanUnusedLinks(maxAge)` - Remove links not accessed in `maxAge` days
- `removeShortLink(shortId)` - Remove a short link by ID

## Testing

Tests run automatically in CI against PostgreSQL versions 14, 15, 16, 17, and 18.

To run tests locally:

```bash
# Start PostgreSQL (using Docker)
docker run --name shortlinks-postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=shortlinks -p 5432:5432 -d postgres:16

# Run tests
POSTGRES_URI=postgres://postgres:password@localhost:5432/shortlinks bun test packages/shortlinks-manager-postgres
```

## Supported PostgreSQL Versions

- PostgreSQL 14 (until 2026)
- PostgreSQL 15
- PostgreSQL 16
- PostgreSQL 17
- PostgreSQL 18 (latest)

## License

MIT
