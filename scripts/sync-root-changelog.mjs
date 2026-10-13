import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { findWorkspacePackageDirs } from './verify-catalog-discipline.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Get list of changed files to only include packages bumped in this release
const changedFiles = execSync('git status --porcelain', { encoding: 'utf8' });

// We use the core engine version as the global release version
const corePkgPath = path.join(rootDir, 'packages/core/package.json');
const corePkg = JSON.parse(fs.readFileSync(corePkgPath, 'utf8'));
const currentVersion = corePkg.version;
const dateStr = new Date().toISOString().split('T')[0];

const rootChangelogPath = path.join(rootDir, 'CHANGELOG.md');
let rootChangelog = fs.readFileSync(rootChangelogPath, 'utf8');

// Default icon used for a package whose name doesn't match one of the well-known display
// overrides below.
const DEFAULT_ICON = '📦';

// Display metadata (a friendly name + icon) for packages this repo knows about by convention.
// This is presentation-only — it never gates *whether* a package is included, only how its
// section header reads. A matched package absent from this map still gets a derived name and
// the default icon, derived from pnpm-workspace.yaml's packages: globs rather than a
// hardcoded array, so: the governed set of *which* packages are checked is always derived.
const DISPLAY_OVERRIDES = {
  '@trace-kit/core': { name: 'Core Engine', icon: '⚡' },
  '@trace-kit/renderers': { name: 'Renderers', icon: '🎨' },
  '@trace-kit/vue': { name: 'Vue Components', icon: '🖖' },
  '@trace-kit/react': { name: 'React Components', icon: '⚛️' },
};

function deriveDisplayName(pkgName) {
  const bare = pkgName.includes('/') ? pkgName.split('/').pop() : pkgName;
  return bare
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Derive the governed package list from `pnpm-workspace.yaml`'s `packages:` globs (reusing
// `findWorkspacePackageDirs`, the same glob-resolution `verify-catalog-discipline.mjs` already
// establishes) instead of a hardcoded array — a matched directory with no `package.json` name
// or no `CHANGELOG.md` is skipped without throwing.
const workspaceYamlText = fs.readFileSync(
  path.join(rootDir, 'pnpm-workspace.yaml'),
  'utf8',
);
const packageDirs = findWorkspacePackageDirs(workspaceYamlText);

const packages = [];
for (const dir of packageDirs) {
  const pkgJsonPath = path.join(rootDir, dir, 'package.json');
  let pkgJson;
  try {
    pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  } catch {
    continue;
  }
  const pkgName = pkgJson.name;
  if (!pkgName) continue;
  const override = DISPLAY_OVERRIDES[pkgName];
  packages.push({
    name: override?.name ?? deriveDisplayName(pkgName),
    path: `${dir}/CHANGELOG.md`,
    pkgName,
    icon: override?.icon ?? DEFAULT_ICON,
  });
}

let newChangelogEntry = `\n## [${currentVersion}](https://github.com/nelomr/trace-kit/releases/tag/v${currentVersion}) (${dateStr})\n\n`;
let hasChanges = false;

for (const pkg of packages) {
  // Only process if this package's CHANGELOG was modified by Changesets in this run
  if (!changedFiles.includes(pkg.path)) {
    continue;
  }

  const fullPath = path.join(rootDir, pkg.path);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf8');

    // Read the package.json to get the package's current bumped version
    const pkgJsonPath = fullPath.replace('CHANGELOG.md', 'package.json');
    if (!fs.existsSync(pkgJsonPath)) continue;

    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    const pkgVersion = pkgJson.version;

    // Match the exact version block for this package's current version
    const regex = new RegExp(`## ${pkgVersion.replace(/\\./g, '\\\\.')}\\n([\\s\\S]*?)(?=\\n## |$)`);
    const match = content.match(regex);

    if (match && match[1].trim()) {
      hasChanges = true;
      let changes = match[1].trim();

      // Clean up headers to make them standard markdown lists instead of H3s
      changes = changes.replace(/### (Patch|Minor|Major) Changes/g, '**$1 Changes**');

      newChangelogEntry += `### ${pkg.icon} ${pkg.name} (\`${pkg.pkgName}\` @ ${pkgVersion})\n\n${changes}\n\n`;
    }
  }
}

if (hasChanges) {
  // Inject after the preamble
  const marker = "and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).\n";
  if (rootChangelog.includes(marker)) {
    rootChangelog = rootChangelog.replace(marker, marker + newChangelogEntry);
    fs.writeFileSync(rootChangelogPath, rootChangelog);
    console.log('✅ Synchronized root CHANGELOG.md');
  } else {
    // Append if marker not found exactly
    rootChangelog += newChangelogEntry;
    fs.writeFileSync(rootChangelogPath, rootChangelog);
    console.log('✅ Appended to root CHANGELOG.md');
  }
} else {
  console.log('ℹ️ No changelog entries found to synchronize.');
}
