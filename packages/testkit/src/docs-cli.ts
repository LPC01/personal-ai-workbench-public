import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkDocs } from './docs-checker.js';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: docs-cli <paths...>');
  process.exit(2);
}

const allIssues = [];
let filesChecked = 0;

for (const p of args) {
  const abs = resolve(p);
  if (!existsSync(abs)) {
    console.error(`path does not exist: ${p}`);
    process.exit(2);
  }
  const result = checkDocs(abs, { baseDir: process.cwd() });
  filesChecked += result.filesChecked;
  allIssues.push(...result.issues);
}

for (const issue of allIssues) {
  console.log(`${issue.file}:${issue.line} [${issue.rule}] ${issue.message}`);
}

if (allIssues.length > 0) {
  console.error(`\n${allIssues.length} doc issue(s) found across ${filesChecked} file(s).`);
  process.exit(1);
}

console.log(`OK: ${filesChecked} file(s) checked, no issues.`);
