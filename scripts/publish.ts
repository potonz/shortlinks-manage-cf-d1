import { $ } from "bun";
import { glob } from "fs/promises";
import { dirname, join } from "path";

for await (const distPackageJson of glob("packages/*/dist/package.json")) {
    const distPkgJsonFile = Bun.file(distPackageJson);
    const rootPackageJson = join(dirname(dirname(distPackageJson)), "package.json");
    await Bun.write(rootPackageJson, distPkgJsonFile);
    await distPkgJsonFile.unlink();
}

for await (const pkgRoot of glob("packages/*")) {
    await $`bun pm pack --destination ../../tarballs`.cwd(pkgRoot);
}

for await (const tar of glob("tarballs/*")) {
    await $`npm publish ./${tar}`;
}
