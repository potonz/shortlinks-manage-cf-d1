import { $ } from "bun";
import { glob } from "fs/promises";
import { dirname, join } from "path";

for await (const distPackageJson of glob("packages/*/dist/package.json")) {
    const rootPackageJson = join(dirname(dirname(distPackageJson)), "package.json");
    await Bun.write(rootPackageJson, Bun.file(distPackageJson));
}

await $`bun run --filter '*' pack`;

for await (const tar of glob("tarballs/*")) {
    await $`npm publish ${tar}`;
}
