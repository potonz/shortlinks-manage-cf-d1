# @potonz/shortlinks-manage-cf-d1

Short links manager backend using Cloudflare D1 database.

## Setting up

You have to manually set up the DB for short links.
A function is provided for this, this should only be called once.

```ts
import { env } from "cloudflare:workers";

const backend = createD1Backend(env.DB);
await backend.setupTables();
```
