# Capability: playground-svg-export-view

> Change: `svg-vector-export` (roadmap `order: 6`). New capability.
>
> Source: `proposal.md` Approach 8 (exploration §7 decision 1). A playground view comparing the
> Canvas2D rendering to the SVG export of the same scenario, with a download.

## ADDED Requirements

### Requirement: The View Renders One Scenario Through Canvas2D and the Exporter Side by Side
The view MUST let the user select a scenario from the shared fixture set (`render-scenario-fixtures`)
and MUST show, side by side at the same CSS size, the `Canvas2DRenderer` output and the document
returned by `exportToSvg` for that same fixture. The exported SVG MUST be displayed from the
returned string (inline or as an image source) without altering it.

#### Scenario: Both panes appear for the selected scenario
- **GIVEN**: the view mounted with a scenario selected
- **WHEN**: it renders
- **THEN**: one `<canvas>` and one SVG display are present, sized identically in CSS px

#### Scenario: Changing the scenario updates both panes
- **GIVEN**: the mounted view
- **WHEN**: another scenario is selected
- **THEN**: both panes re-render from the new fixture

### Requirement: The View Offers a Download of the Exported Document
The view MUST provide a control that downloads exactly the string returned by `exportToSvg` for
the current scenario as an `.svg` file (MIME `image/svg+xml`), named after the scenario. The
control MUST release any created object URL after use.

#### Scenario: Downloaded bytes equal the export
- **GIVEN**: a scenario displayed
- **WHEN**: the download control is activated
- **THEN**: the produced file's contents are strictly equal to `exportToSvg(fixture)` and its
  type is `image/svg+xml`

#### Scenario: Object URLs are released
- **GIVEN**: a download performed
- **WHEN**: it completes
- **THEN**: `URL.revokeObjectURL` has been called for the created URL

### Requirement: The View Exposes the Export Options Under Test
The view MUST expose controls for `decimationTarget` (empty means default) and font embedding
(off by default). With defaults, the displayed and downloaded document MUST equal the committed
golden for the scenario.

#### Scenario: Defaults match the golden
- **GIVEN**: a parity scenario with all controls at default
- **WHEN**: the view produces the document
- **THEN**: it is strictly equal to that scenario's committed `.svg` golden

#### Scenario: Enabling font embedding adds the font
- **GIVEN**: the font embedding control switched on
- **WHEN**: the document is produced
- **THEN**: it contains exactly one `@font-face`

### Requirement: Balanced Lifecycle With No Leaks
Following `playground-routing`'s lifecycle rule, unmounting the view MUST dispose the Canvas2D
renderer, remove its listeners, and release any object URL, leaving no retained DOM node.

#### Scenario: Mount then unmount leaves nothing behind
- **GIVEN**: the view mounted then unmounted
- **WHEN**: the document and renderer registry are inspected
- **THEN**: no canvas, SVG node, listener or object URL from the view remains

## ADDED Requirements

### Requirement: The View Offers CSV and `.npy` Downloads of the Current Window
The view MUST provide a minimal control set to download the current scenario's raw data through
`@trace-kit/core`'s exporters: a CSV download of the whole collection, and an `.npy` download of one
selected array (trace and X or Y). The window MUST be given by optional `xMin`/`xMax` inputs that
default (empty) to the scenario collection's shared X domain; resolution MUST use the strict default
of `viewport-window-resolution`. Downloaded bytes MUST be exactly the concatenation of the exporter's
chunks, copied before advancing, with MIME `text/csv` and `application/octet-stream`, and file names
derived from the scenario name (and, for `.npy`, the trace id and array). Object URLs MUST be
released after use. No new route MAY be added.

#### Scenario: CSV bytes equal the exporter output
- **GIVEN**: a scenario displayed with default window
- **WHEN**: the CSV download is activated
- **THEN**: the file's text is strictly equal to the joined output of `exportCsv` for that collection and window, with type `text/csv`

#### Scenario: NPY bytes equal the exporter output
- **GIVEN**: a scenario, trace and array selected
- **WHEN**: the `.npy` download is activated
- **THEN**: the file's bytes equal the concatenated (copied) chunks of `exportNpy`, begin with `93 4E 55 4D 50 59 01 00`, and the file name ends in `.npy`

#### Scenario: A narrowed window narrows the download
- **GIVEN**: `xMin`/`xMax` set to a sub-range of the scenario's data
- **WHEN**: CSV is downloaded
- **THEN**: all rows have X within `[xMin, xMax]`

#### Scenario: Chunks are copied, not retained by reference
- **GIVEN**: a multi-chunk `.npy` export
- **WHEN**: the download file is built
- **THEN**: its bytes equal the reference bytes (no aliasing corruption)

#### Scenario: Object URLs are released
- **GIVEN**: a CSV and an `.npy` download performed
- **WHEN**: each completes
- **THEN**: `URL.revokeObjectURL` has been called for each created URL

#### Scenario: Invalid window input does not download garbage
- **GIVEN**: a non-numeric `xMin`
- **WHEN**: a download is activated
- **THEN**: the control reports the invalid input and no file is produced, or the field is treated as empty (design fixes which), and no exception escapes

### Requirement: Download Controls Respect the Balanced Lifecycle
Unmounting the view MUST remove the listeners of the new controls and release any outstanding
object URL, leaving no retained DOM node, extending `Balanced Lifecycle With No Leaks`.

#### Scenario: Mount then unmount after a download leaves nothing behind
- **GIVEN**: the view mounted, a CSV download performed, then unmounted
- **WHEN**: listener counts and the document are inspected
- **THEN**: add/remove listener counts balance, no control node remains, and no object URL is outstanding
