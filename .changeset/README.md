# Changesets in TraceKit

This project uses [Changesets](https://github.com/changesets/changesets) to manage versions and changelogs across our monorepo packages.

## How it works

When you make a change that affects a package, you create a "changeset" - a small markdown file that records what changed and how it should bump the version. During the release process, these files are consumed to automatically bump package versions and generate `CHANGELOG.md` files.

Note: In TraceKit, **versions start at 0.0.0 and only patch versions are bumped (e.g., 0.0.1, 0.0.2...)** until a stable release.

## Creating a changeset

### Interactive CLI

The easiest way to create a changeset is using the interactive CLI:

```bash
pnpm changeset
```

Follow the prompts to select which packages changed, whether the bump should be major, minor, or patch (always select patch for now), and write a short summary.

### Manual File

Alternatively, you can manually create a markdown file in the `.changeset` directory. The file name should be three random words separated by hyphens (e.g., `.changeset/swift-cats-jump.md`).

#### Example of a manual changeset file:

```md
---
"@trace-kit/core": patch
"@trace-kit/react": patch
---

Fixed an issue where decimation would drop the last point in the buffer, ensuring lossless vector reporting for the final data segment.
```

## When NOT to create a changeset

Do **not** create a changeset if your commit only contains:
- `docs:` (Documentation changes)
- `refactor:` (Code refactoring with no functional change)
- `test:` (Adding or modifying tests)
- `chore:` (Maintenance, dependencies, etc.)
- `style:` (Code formatting)
- `ci:` (CI/CD pipeline changes)

Changesets should only be used for `feat:` and `fix:` commits that affect the published packages.
