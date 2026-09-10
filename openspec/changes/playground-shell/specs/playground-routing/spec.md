# Capability: playground-routing

> Change: `playground-shell`. New capability.

## ADDED Requirements

### Requirement: Additive Route Registration
The route registry MUST resolve exactly the set of registered views, and registering an
additional view MUST require no edit to the shell (no switch statement, no central view list to
modify).

#### Scenario: A fixture view registers without editing the shell
- **GIVEN**: a fixture view module declaring a path, a label, and a mount/unmount pair, added via
  the registry's registration function
- **WHEN**: the shell's route resolution runs
- **THEN**: the fixture view's path resolves to the fixture's mount function, with no change
  required to any existing shell source file

#### Scenario: The registry resolves exactly the registered views
- **GIVEN**: exactly one view (`/core-math`) registered at this change
- **WHEN**: the registry's list of resolvable paths is inspected
- **THEN**: it contains exactly `/core-math` and no other path

### Requirement: Balanced Mount/Unmount Lifecycle
A view's mount and unmount pair MUST be balanced: after unmount, the view MUST hold no event
listener, no animation-frame callback, and no observer that it registered during mount. This
MUST be asserted by count, not by manual inspection.

#### Scenario: Unmounting a fixture view leaves zero registered listeners
- **GIVEN**: a fixture view that registers one `resize` listener and one
  `requestAnimationFrame` callback during mount
- **WHEN**: the view is mounted and then unmounted, and the test instruments
  `addEventListener`/`removeEventListener` and `requestAnimationFrame`/`cancelAnimationFrame`
  call counts
- **THEN**: after unmount, the number of `removeEventListener` calls matching the mount's
  `addEventListener` calls is equal, and the animation-frame callback is cancelled, leaving a
  net-zero outstanding registration count
