const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '..', '..');

function collectJavaScriptFiles(directory) {
    if (!fs.existsSync(directory)) {
        return [];
    }

    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectJavaScriptFiles(entryPath));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(entryPath);
        }
    }
    return files;
}

const files = [
    ...collectJavaScriptFiles(path.join(repositoryRoot, 'extension', 'js')),
    ...collectJavaScriptFiles(path.join(repositoryRoot, 'native-host')),
    path.join(repositoryRoot, 'landing-demo.js'),
    path.join(repositoryRoot, 'landing-developer-demo.js')
].filter((filePath, index, allFiles) => allFiles.indexOf(filePath) === index)
    .sort((left, right) => left.localeCompare(right));

if (files.length === 0) {
    console.error('No production JavaScript files were found.');
    process.exit(1);
}

let failures = 0;
for (const filePath of files) {
    const result = spawnSync(process.execPath, ['--check', filePath], {
        cwd: repositoryRoot,
        encoding: 'utf8'
    });

    if (result.status !== 0) {
        failures += 1;
        process.stderr.write(result.stderr || `Syntax check failed: ${filePath}\n`);
    } else {
        console.log(`OK ${path.relative(repositoryRoot, filePath)}`);
    }
}

if (failures > 0) {
    console.error(`${failures} JavaScript file(s) failed syntax validation.`);
    process.exit(1);
}

console.log(`Validated ${files.length} production JavaScript file(s).`);
