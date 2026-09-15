# Capability: playground-instrumentation-panel

## ADDED Requirements

### Requirement: Shared Tweakpane Panel Surface
A single shared tweakpane panel instance MUST exist, and a view MUST populate it with its own
controls and readouts rather than constructing its own independent panel instance.

#### Scenario: Two views contribute to the same panel instance
- **GIVEN**: the `/core-math` view and a fixture second view, both mounted in sequence within a
  test
- **WHEN**: each view's mount function adds controls to the panel
- **THEN**: both sets of controls are added to the same shared panel instance (verified by
  reference equality of the panel object each view receives), not to two separate panel
  instances

### Requirement: The Shared Panel Is Backed by tweakpane
The shared instrumentation panel MUST be implemented using the `tweakpane` library, consumed via
the workspace catalog (see `workspace-toolchain`), rather than a bespoke control surface. This is
the library the roadmap decomposition names for this seam
(`openspec/changes/00-roadmap-decomposition/exploration.md`, change 4's scope row), and binding
the requirement to it — rather than leaving the panel library-agnostic — keeps every later view
(changes 5, 7, 10, 11, 13, 14, 16) contributing controls to the same concrete API rather than to
an abstraction this change never specifies.

#### Scenario: The panel module imports tweakpane
- **GIVEN**: the source file implementing the shared panel surface under
  `apps/playground/src/`
- **WHEN**: its import statements are inspected
- **THEN**: it imports from `tweakpane`, and `apps/playground/package.json` declares
  `tweakpane: catalog:` as a dependency

#### Scenario: Exactly one shared panel instance exists, not one per view
- **GIVEN**: the `/core-math` view and a fixture second view, both mounted in sequence within a
  test
- **WHEN**: the module providing the panel is inspected for how many `tweakpane` `Pane` (or
  equivalent root) instances it constructs across both views' mount calls
- **THEN**: exactly one `Pane` instance is constructed for the test's lifetime, and both views
  receive a reference to that same instance rather than each constructing their own

### Requirement: Panel Contributions Are Cleaned Up on Unmount
When a view unmounts, its contributed panel controls MUST be removed from the shared panel, so a
later view does not inherit stale controls.

#### Scenario: Unmounting a view removes its controls from the shared panel
- **GIVEN**: a fixture view that adds two controls to the panel during mount
- **WHEN**: the view unmounts
- **THEN**: the panel's control list no longer contains either of the two controls the view
  added
