# @potonz/shortlinks-manager-mysql

MySQL/MariaDB backend for short links manager using [mysql2](https://github.com/sidorares/node-mysql2).

## Features

- Full MySQL and MariaDB support with mysql2
- Automatic table creation and indexing
- Support for MySQL 8.0+ and MariaDB 10.11+
- Promise-based API with async/await
- Connection via URI string or configuration object
- Parameterized queries for security

## Installation

```bash
bun add @potonz/shortlinks-manager-mysql
```

## Usage

```typescript
import { createManager } from "@potonz/shortlinks-manager";
import { createMysqlBackend } from "@potonz/shortlinks-manager-mysql";

// Create backend with connection URI
const backend = createMysqlBackend("mysql://user:password@localhost:3306/shortlinks");

// OR create backend with connection config object
const backend = createMysqlBackend({
    host: "localhost",
    port: 3306,
    user: "username",
    password: "password",
    database: "shortlinks"
});

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

CREATE INDEX idx_sl_links_map_last_accessed_at
ON sl_links_map(last_accessed_at);
```

## API

### `createMysqlBackend(connection)`

Creates a MySQL backend instance.

**Parameters:**
- `connection` - Connection URI string (e.g., `mysql://user:password@localhost:3306/dbname`) or connection config object with `host`, `port`, `user`, `password`, `database` properties

**Returns:** `IShortLinksManagerMysqlBackend`

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

Tests require a MySQL or MariaDB instance running.

To run tests locally:

```bash
# Start MySQL (using Docker)
docker run --name shortlinks-mysql -e MYSQL_ROOT_PASSWORD=password -e MYSQL_DATABASE=shortlinks -p 3306:3306 -d mysql:8

# Run tests
MYSQL_URI=mysql://root:password@localhost:3306/shortlinks bun test packages/shortlinks-manager-mysql
```

## Supported Versions

### MySQL
- MySQL 8.0 (LTS, extended support until April 2026)
- MySQL 8.4 (LTS)

### MariaDB
- MariaDB 10.11 (LTS)
- MariaDB 11.4 (LTS)
- MariaDB 11.8 (LTS)

## License

MIT
