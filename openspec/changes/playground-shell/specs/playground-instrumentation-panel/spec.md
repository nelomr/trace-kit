# Capability: playground-instrumentation-panel

> Change: `playground-shell`. New capability.

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

### Requirement: Panel Contributions Are Cleaned Up on Unmount
When a view unmounts, its contributed panel controls MUST be removed from the shared panel, so a
later view does not inherit stale controls.

#### Scenario: Unmounting a view removes its controls from the shared panel
- **GIVEN**: a fixture view that adds two controls to the panel during mount
- **WHEN**: the view unmounts
- **THEN**: the panel's control list no longer contains either of the two controls the view
  added
