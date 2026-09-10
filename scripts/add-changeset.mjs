import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const changesetDir = path.join(rootDir, '.changeset');

// Read CLI arguments
// Usage: node scripts/add-changeset.mjs [message] [bumpType] [packageName]
const args = process.argv.slice(2);
const message = args[0] || 'routine updates and maintenance';
const bumpType = ['patch', 'minor', 'major'].includes(args[1]?.toLowerCase())
  ? args[1].toLowerCase()
  : 'patch';
const targetPkg = args[2] || '@trace-kit/core';

if (!fs.existsSync(changesetDir)) {
  fs.mkdirSync(changesetDir, { recursive: true });
}

// Generate unique slug
const slug = `${bumpType}-${crypto.randomBytes(4).toString('hex')}`;
const filePath = path.join(changesetDir, `${slug}.md`);

const content = `---
"${targetPkg}": ${bumpType}
---

${message}
`;

fs.writeFileSync(filePath, content, 'utf8');
console.log(`✅ Changeset created: .changeset/${slug}.md`);
console.log(`   Package: ${targetPkg} (${bumpType})`);
console.log(`   Summary: "${message}"`);
