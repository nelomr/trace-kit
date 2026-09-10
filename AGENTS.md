# Agent Teams — TraceKit Agent Skills Index

When working on this project, load the relevant skill(s) BEFORE writing or modifying any code.

## How to Use

1. Check the trigger column to find skills that match your current task.
2. Load the skill by reading the `SKILL.md` file at the listed path.
3. Follow ALL patterns and rules from the loaded skill.
4. Multiple skills can apply simultaneously.

## SDD Phase Skills & Subagents

| Skill | Trigger | Path | Subagent / Command |
|---|---|---|---|
| `sdd-explore` | Thinking through a feature, investigating codebase, or clarifying requirements | [`.agent/skills/sdd-explore/SKILL.md`](.agent/skills/sdd-explore/SKILL.md) | `/sdd:explore` |
| `sdd-propose` | Creating or updating a change proposal with intent, scope, and approach | [`.agent/skills/sdd-propose/SKILL.md`](.agent/skills/sdd-propose/SKILL.md) | `/sdd:propose` |
| `sdd-spec` | Writing or updating specifications with normative requirements (MUST/SHALL) & scenarios | [`.agent/skills/sdd-spec/SKILL.md`](.agent/skills/sdd-spec/SKILL.md) | `/sdd:spec` |
| `sdd-design` | Writing technical design with architecture decisions (zero-copy, dual-engine, branded buffers) | [`.agent/skills/sdd-design/SKILL.md`](.agent/skills/sdd-design/SKILL.md) | `/sdd:design` |
| `sdd-tasks` | Breaking down a change into an implementation task checklist ordered by TDD | [`.agent/skills/sdd-tasks/SKILL.md`](.agent/skills/sdd-tasks/SKILL.md) | `/sdd:tasks` |
| `sdd-apply` | Implementing tasks with TDD (RED-GREEN-REFACTOR) and updating `resume-apply.md` | [`.agent/skills/sdd-apply/SKILL.md`](.agent/skills/sdd-apply/SKILL.md) | `/sdd:apply` |
| `sdd-verify` | Validating implementation with live test execution and scenario compliance matrix | [`.agent/skills/sdd-verify/SKILL.md`](.agent/skills/sdd-verify/SKILL.md) | `/sdd:verify` |
| `sdd-archive` | Merging spec deltas into main specs and archiving completed change | [`.agent/skills/sdd-archive/SKILL.md`](.agent/skills/sdd-archive/SKILL.md) | `/sdd:archive` |

## Code Quality & Engineering Skills

| Skill | Trigger | Path | Subagent / Command |
|---|---|---|---|
| `judgment-day` | Ruthless quality audit before merge or release (cero `any`, no allocations en render loop) | [`.agent/skills/judgment-day/SKILL.md`](.agent/skills/judgment-day/SKILL.md) | `/sdd:judgment` |
| `git-and-release` | Creating changesets, patch versioning (`0.0.x`), commit conventions | [`.agent/skills/git-and-release/SKILL.md`](.agent/skills/git-and-release/SKILL.md) | — |
| `technical-documentation` | Writing architecture docs, API contracts, benchmark tables, mathematical notation | [`.agent/skills/technical-documentation/SKILL.md`](.agent/skills/technical-documentation/SKILL.md) | — |

## Storage & Persistence Policy
TraceKit uses **pure filesystem-based OpenSpec storage** (`openspec/changes/{change}/`). No external memory tools (`mem_*`) are required or used.
