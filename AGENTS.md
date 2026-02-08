# AGENTS.md

## Commands

- `bun run build` - Build all packages
- `bun run release` - Run release script  
- `bun run publish` - Publish packages
- `bun run lint` - Run ESLint with auto-fix
- `bun run lint:check` - Run ESLint check only
- `bun test` - Run all tests
- `bun test path/to/file.test.ts` - Run single test file
- `bun run cf-typegen` - Generate Cloudflare types (cf-d1 package)

Always run `bun run lint` after making changes.

## Project Structure

Monorepo with Bun workspaces:
- `packages/shortlinks-manager/` - Core package (no dependencies)
- `packages/shortlinks-manager-cloudflare-d1/` - Cloudflare D1 database backend (SQLite)
- `packages/shortlinks-manager-mysql/` - MySQL database backend
- `packages/shortlinks-manager-postgres/` - Postgres database backend
- Tests in `packages/*/test/` using Bun's test runner

## Code Style

### Formatting
- Indentation: 4 spaces
- Semicolons: Required
- Quotes: Double quotes
- Max line length: None

### TypeScript
- Strict mode enabled (tsconfig.json)
- Target: ES2020, Module: Preserve
- Explicit types for function parameters and returns
- Use `interface` for public APIs, `type` for complex definitions
- Prefix interfaces with `I` (e.g., `IManagerProps`)

### Imports
- Inline type imports: `import type { Foo } from "bar"`
- Imports auto-sorted via simple-import-sort plugin
- Group: external imports first, then internal
- No `../` chains - use package imports

### Naming
- Interfaces: PascalCase with `I` prefix
- Functions/variables: camelCase
- Constants: UPPER_SNAKE_CASE or camelCase
- Files: camelCase

### Error Handling
- Use JSDoc `@throws` for documented errors
- Throw descriptive Error instances
- Return null/undefined for "not found", not errors
- Handle async errors appropriately

### Documentation
- JSDoc for all public APIs
- Include `@param`, `@returns`, `@throws` tags
- Keep comments concise

## Testing

- Framework: Bun's built-in test runner (`bun:test`)
- Pattern: `*.test.ts` in `test/` directories
- Use `beforeEach` for setup, `mock.module()` for mocking
- Assert with `expect()` from `bun:test`
- Run single test: `bun test packages/shortlinks-manager/test/manager.test.ts`

## Key Components

### Core Package
- `manager.ts` - Main manager with `createManager()`, `createShortLink()`, `getTargetUrl()`
- `cache.ts` - Cache interface with `get()`, `set()`, `init()`
- `utils.ts` - Utility functions for ID generation

### Cloudflare D1 Package  
- `backend.ts` - D1 backend implementing `IShortLinksManagerBackend`
- Uses `sl_links_map` table for storage

## Linting

ESLint with TypeScript and Stylistic plugins configured in `eslint.config.js`:
- Import sorting enforced
- Consistent type imports required
- 4-space indentation, semicolons, double quotes

Run `bun run lint` before committing. Auto-fix with `bun run lint:fix`.

## Best Practices

1. Maintain strict TypeScript typing throughout
2. Use interfaces for flexible backend implementations  
3. Implement caching layers to improve performance
4. Handle errors properly in all operations
5. Write comprehensive tests for all functionality
6. Document public APIs with JSDoc comments
