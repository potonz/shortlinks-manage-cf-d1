import { $, Glob } from "bun";
import { createSpinner } from "nanospinner";
import { argv } from "process";
import { createInterface } from "readline";

const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
});

const question = function (query: string) {
    return new Promise<string>((resolve) => {
        readline.question(query, resolve);
    });
};

if (argv.length < 3) {
    console.log("Usage: bun release.ts <version>");
    process.exit(1);
}

const version = argv[2];

// Update package.json version
async function updatePkgJson(file: string) {
    const spinner = createSpinner(`Updating ${file} version`).start();
    try {
        const packageJsonFile = Bun.file(file);
        const packageJson = await packageJsonFile.json();
        packageJson.version = version;
        await packageJsonFile.write(JSON.stringify(packageJson, null, 2) + "\n");

        spinner.success({ text: `Updated ${file} version` });
    }
    catch {
        spinner.error({ text: "Failed to update package.json version" });
        process.exit(1);
    }
}

const pkgJsonGlob = new Glob("packages/*/package.json");
for await (const file of pkgJsonGlob.scan()) {
    await updatePkgJson(file);
}

// Run git-cliff to generate CHANGELOG.md
let spinner = createSpinner("Generating CHANGELOG.md").start();
try {
    await $`git cliff -u -t v${version} -s all -p CHANGELOG.md`.quiet();
    spinner.success({ text: "CHANGELOG.md generated" });
}
catch {
    spinner.error({ text: "Failed to generate CHANGELOG.md" });
    process.exit(1);
}

// Create a git tag
spinner = createSpinner("Creating git tag").start();
try {
    await $`git add .`;
    await $`git commit -m "chore(release): prepare for v${version}"`;
    await $`git tag -a v${version} -m "Release v${version}"`;

    spinner.success({ text: "Git tag created" });
}
catch {
    spinner.error({ text: "Failed to create git tag" });
    process.exit(1);
}

try {
    const answer = await question("Do you want to push the commits to GitHub? (Y/n) ");

    if (!answer || answer.toLowerCase() === "y") {
        // Push changes to GitHub
        spinner = createSpinner("Pushing changes to GitHub").start();
        try {
            await $`git push`;
            spinner.success({ text: "Changes pushed to GitHub" });
        }
        catch {
            spinner.error({ text: "Failed to push changes to GitHub" });
            process.exit(1);
        }
    }
    else {
        process.exit(0);
    }
}
catch (err) {
    console.log(err);
    process.exit(1);
}

try {
    const answer = await question("Do you want to push new tag? (y/n) ");

    if (answer.toLowerCase() === "y") {
        // Push tag to GitHub
        spinner = createSpinner("Pushing tag to GitHub").start();
        try {
            await $`git push origin v${version}`;
            spinner.success({ text: "Tag pushed to GitHub" });
        }
        catch {
            spinner.error({ text: "Failed to push tag to GitHub" });
            process.exit(1);
        }
    }
}
catch (err) {
    console.log(err);
    process.exit(1);
}

readline.close();
process.exit(0);
