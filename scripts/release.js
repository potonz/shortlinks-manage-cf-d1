#!/usr/bin/env node

import fs from "fs";
import { argv } from "process";
import { execSync } from "child_process";
import { createSpinner } from "nanospinner";
import { createInterface } from "readline";
import util from "util";

const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
});

const question = util.promisify(readline.question).bind(readline);

if (argv.length < 3) {
    console.log("Usage: node release.js <version>");
    process.exit(1);
}

const version = argv[2];

// Write to VERSION file to trigger deploy to Pages
let spinner = createSpinner("Writing version to VERSION file").start();
try {
    fs.writeFileSync("VERSION", version);
    spinner.success({ text: "Version written to VERSION file" });
}
catch {
    spinner.error({ text: "Failed to write version to VERSION file" });
    process.exit(1);
}

// Update package version
spinner = createSpinner("Updating package.json version").start();
try {
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    packageJson.version = version;
    fs.writeFileSync("package.json", JSON.stringify(packageJson, null, 2) + "\n");

    spinner.success({ text: "package.json version updated" });
}
catch {
    spinner.error({ text: "Failed to update package.json version" });
    process.exit(1);
}

// Run git-cliff to generate CHANGELOG.md
spinner = createSpinner("Generating CHANGELOG.md").start();
try {
    execSync(`git cliff -u -t v${version} -s all -p CHANGELOG.md`);
    spinner.success({ text: "CHANGELOG.md generated" });
}
catch {
    spinner.error({ text: "Failed to generate CHANGELOG.md" });
    process.exit(1);
}

// Create a git tag
spinner = createSpinner("Creating git tag").start();
try {
    execSync("git add .");
    execSync(`git commit -m "chore(release): prepare for v${version}"`);
    execSync(`git tag -a v${version} -m "Release v${version}"`);

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
            execSync("git push");
            spinner.success({ text: "Changes pushed to GitHub" });
        }
        catch {
            spinner.error({ text: "Failed to push changes to GitHub" });
            process.exit(1);
        }
    }
}
catch (err) {
    console.log(err);
}

try {
    const answer = await question("Do you want to push new tag? (y/n) ");

    if (answer.toLowerCase() === "y") {
        // Push tag to GitHub
        spinner = createSpinner("Pushing tag to GitHub").start();
        try {
            execSync(`git push origin v${version}`);
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
}

readline.close();
process.exit(0);
