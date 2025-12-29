#!/usr/bin/env bun

import fs, { rmSync } from "fs";
import path from "path";
import {
    type CompilationOptions,
    type EntryPointConfig,
    generateDtsBundle,
} from "dts-bundle-generator";
import type { BunPlugin } from "bun";

type Options = Omit<EntryPointConfig, "filePath"> & {
    compilationOptions?: CompilationOptions;
};

function dts(options?: Options): BunPlugin {
    return {
        name: "bun-plugin-dts",
        async setup(build) {
            const { compilationOptions, ...rest } = options || {};

            const entrypoints = [...build.config.entrypoints].sort();
            const entries = entrypoints.map((entry) => {
                return {
                    filePath: entry,
                    ...rest,
                };
            });

            const result = generateDtsBundle(entries, compilationOptions);

            const outDir = build.config.outdir || "./dist";
            if (!fs.existsSync(outDir)) {
                fs.mkdirSync(outDir, { recursive: true });
            }

            const commonPrefix = path.dirname(entrypoints[0]!);

            await Promise.all(
                entrypoints.map((entry, index) => {
                    const relativePath = path.relative(commonPrefix, entry);
                    const dtsFile = relativePath.replace(/\.[jt]s$/, ".d.ts");
                    const outFile = path.join(outDir, dtsFile);
                    const outFileDir = path.dirname(outFile);

                    if (!fs.existsSync(outFileDir)) {
                        fs.mkdirSync(outFileDir, { recursive: true });
                    }

                    return Bun.write(outFile, result[index]!);
                }),
            );
        },
    };
};

const license = await Bun.file("LICENSE").text();

async function buildPackage(name: string) {
    // Remove old files
    rmSync(`./packages/${name}/dist`, { recursive: true, force: true });

    // Bundle
    await Bun.build({
        entrypoints: [`./packages/${name}/src/index.ts`],
        outdir: `./packages/${name}/dist`,
        format: "esm",
        target: "node",
        sourcemap: false,
        minify: true,
        external: ["node:*", "bun:*"],
        banner: `/* ${license} */\n`,
        plugins: [
            dts({
                compilationOptions: {
                    preferredConfigPath: `./packages/${name}/tsconfig.bundle.json`,
                },
            }),
        ],
    });

    // Remove dependencies from package.json
    const packageJson = await Bun.file(`./packages/${name}/package.json`).json();
    delete packageJson.devDependencies;
    delete packageJson.peerDependencies;
    delete packageJson.optionalDependencies;
    delete packageJson.scripts;
    await Bun.write(`./packages/${name}/dist/package.json`, JSON.stringify(packageJson, null, 2));
}

await buildPackage("shortlinks-manager");
await buildPackage("shortlinks-manager-cloudflare-d1");
