# Capability: playground-routing

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
- **GIVEN**: exactly two views (`/home`, `/core-math`) registered at this change
- **WHEN**: the registry's list of resolvable paths is inspected
- **THEN**: it contains exactly `/home` and `/core-math`, and no other path

### Requirement: Landing View and Default Route
A `/home` view MUST be registered, listing every other registered view (read from the registry
at mount time, not hand-maintained) as a navigable link. When the location hash is empty or
does not resolve to a registered path, the shell MUST land on `/home` rather than rendering a
"not found" panel — the professional-tool convention of an index page instead of a dead root
route.

#### Scenario: A fresh visit with no hash lands on the landing view
- **GIVEN**: the app is loaded with an empty `location.hash`
- **WHEN**: the shell finishes its initial navigation
- **THEN**: `/home` is mounted, and `location.hash` is updated to `#/home` (so a refresh or a
  shared link reproduces the same view)

#### Scenario: The landing view lists every other registered view
- **GIVEN**: `/home` is mounted with `/core-math` registered alongside it
- **WHEN**: the landing view's content is inspected
- **THEN**: it contains a link to `/core-math` and does not list itself

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
