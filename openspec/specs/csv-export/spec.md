# Capability: csv-export

> Change: `raw-data-viewport-export` (roadmap `order: 6.5`). New capability.
>
> Source: `proposal.md` Approach 2 and 4. Implemented as `exportCsv` in `packages/core/src/export/csv.ts`.

## ADDED Requirements

### Requirement: CSV Is a Synchronous Generator Over a TraceCollection Window
`@trace-kit/core` MUST export from its root entry `exportCsv`, a synchronous generator that yields string chunks
whose concatenation is a complete CSV document for a `TraceCollection` and a window
`[xMin, xMax]` (with the neighbour option of `viewport-window-resolution`). Window resolution MUST be
done per entry against that entry's own `x`, `xOrigin` and `sampleCount`, before any decimation. The
export MUST read the authoritative payload buffers and MUST NOT read decimated or drawn points. The
function MUST be synchronous (no `Promise`, no async iteration) and MUST NOT mutate the collection.

#### Scenario: Chunks concatenate to the document
- **GIVEN**: a one-trace collection of 3 samples in the window
- **WHEN**: all chunks are joined
- **THEN**: the result is the header line followed by exactly 3 data lines

#### Scenario: Export reads raw data, not decimated data
- **GIVEN**: a payload of 1,000,000 samples and a window covering all of it
- **WHEN**: the export is consumed
- **THEN**: it emits 1,000,000 data rows (no decimation applied)

#### Scenario: The generator is lazy and synchronous
- **GIVEN**: a created generator
- **WHEN**: no `next()` has been called
- **THEN**: nothing has been read from the payload, and `next()` returns a plain `IteratorResult`, not a `Promise`

### Requirement: Format Is Long/Tidy `trace_id,x,y` With a Fixed Header and Row Order
The first line MUST be the header `trace_id,x,y`. Each in-window sample MUST produce one row
`<trace_id>,<x>,<y>`. Rows MUST be ordered by collection entry order, then by ascending source index
within an entry. Fields MUST be separated by `,` and lines terminated by `\n` (LF), including the
last data line. A collection or window yielding no samples MUST produce the header line only.
Entries with an empty span MUST contribute no rows and MUST NOT affect other entries.

#### Scenario: Two traces keep entry order, not id order
- **GIVEN**: a collection with entries `"b"` (samples X 1,2) then `"a"` (samples X 1,2)
- **WHEN**: exported over a window covering both
- **THEN**: the rows are `b,1,..`, `b,2,..`, `a,1,..`, `a,2,..` in that order

#### Scenario: Entries have independent sample counts, origins and windows
- **GIVEN**: entry `"p"` with `xOrigin = 1550`, 3 samples, and entry `"q"` with `xOrigin = 0`, 5 samples
- **WHEN**: exported over one window
- **THEN**: each entry's rows come from its own span computed on its own absolute X, with `p` rows showing `1550 + offset`

#### Scenario: Empty window yields only the header
- **GIVEN**: a window outside all data
- **WHEN**: exported
- **THEN**: the output is exactly `trace_id,x,y\n`

#### Scenario: An entry with no in-window samples is skipped
- **GIVEN**: entries `"a"` (in window) and `"b"` (outside window)
- **WHEN**: exported
- **THEN**: all data rows carry `a`

#### Scenario: Empty collection
- **GIVEN**: a collection with zero entries
- **WHEN**: exported
- **THEN**: the output is exactly `trace_id,x,y\n`

### Requirement: Numbers Are Absolute f64 X, Shortest Round-Trip, Locale-Independent
X MUST be written as the f64 sum `xOrigin + x[i]` in the shortest decimal text that parses back to
exactly that f64 (JavaScript `Number` to string semantics, with `-0` written as `-0`). Y MUST be
written as `String(v)` where `v` is the stored value widened to f64 (the same routine as X, with
`-0` written as `-0`); for example `Math.fround(0.1)` is written `0.10000000149011612`. The
shortest-f32 form (`0.1`) is a non-goal of this change. Non-goal note: no f32-specific shortest
printing algorithm is introduced. The locale rule follows. Output MUST NOT depend on locale: the decimal
separator MUST be `.`, no grouping separators, no locale APIs. The export MUST NOT invent digits
beyond what the stored data holds. Output MUST be byte-deterministic: the same inputs MUST produce
identical bytes across runs and environments.

#### Scenario: Absolute X is reconstructed, not the raw offset
- **GIVEN**: `xOrigin = 1550`, offset stored as `Math.fround(0.123456)`
- **WHEN**: exported
- **THEN**: the X field equals `String(1550 + Math.fround(0.123456))`

#### Scenario: X round-trips exactly
- **GIVEN**: any exported row
- **WHEN**: its X field is parsed with `Number()`
- **THEN**: it is `===` to `xOrigin + x[i]` computed in f64

#### Scenario: Y is the widened f64 shortest string
- **GIVEN**: a Y value stored as `Math.fround(0.1)`
- **WHEN**: exported
- **THEN**: the Y field is exactly `0.10000000149011612` (equal to `String(Math.fround(0.1))`), and `Number(field) === Math.fround(0.1)`

#### Scenario: Negative zero is preserved
- **GIVEN**: a Y sample of `-0`
- **WHEN**: exported
- **THEN**: the Y field is `-0`

#### Scenario: Locale does not change output
- **GIVEN**: the same export run with the process locale set to one that uses `,` as decimal separator
- **WHEN**: the bytes are compared with a default-locale run
- **THEN**: they are identical

#### Scenario: Deterministic across runs
- **GIVEN**: the same collection and window
- **WHEN**: exported twice
- **THEN**: the two outputs are byte-identical

### Requirement: Gaps and Infinities Use Literal Tokens
A `NaN` Y sample (a gap per `gap-sentinel-semantics`) MUST be written as the literal `NaN`. A Y of
`+Infinity` MUST be written `Infinity` and `-Infinity` as `-Infinity`; these are real values, not
gaps. A gap row MUST still be emitted (the sample is in the window) so that row count equals the
span length. `NaN` in X is out of contract and has no defined output.

#### Scenario: A gap row is emitted with NaN
- **GIVEN**: Y `[1, NaN, 3]` inside the window
- **WHEN**: exported
- **THEN**: three data rows are emitted and the second Y field is `NaN`

#### Scenario: Infinities are distinct from gaps
- **GIVEN**: Y `[Infinity, -Infinity, NaN]`
- **WHEN**: exported
- **THEN**: the Y fields are `Infinity`, `-Infinity`, `NaN` respectively

#### Scenario: All-gap trace
- **GIVEN**: a trace whose Y is entirely `NaN`
- **WHEN**: exported
- **THEN**: every in-window row is emitted with Y `NaN`

### Requirement: trace_id Is Quoted and Escaped per RFC 4180
A `trace_id` containing `,`, `"`, CR or LF MUST be written enclosed in double quotes with each
embedded `"` doubled. Other ids MUST be written unquoted and unmodified (including empty string,
spaces and non-ASCII text). The header line MUST NOT be quoted. Numeric fields MUST never need
quoting.

#### Scenario: Comma in id
- **GIVEN**: id `a,b`
- **WHEN**: a row is exported
- **THEN**: the row starts with `"a,b",`

#### Scenario: Quote in id
- **GIVEN**: id `say "hi"`
- **WHEN**: a row is exported
- **THEN**: the row starts with `"say ""hi""",`

#### Scenario: Newline in id
- **GIVEN**: id with an embedded `\n`
- **WHEN**: exported
- **THEN**: the id is quoted and the embedded newline is preserved inside the quotes, and a standard RFC 4180 parser recovers the original id

#### Scenario: Plain, empty and non-ASCII ids
- **GIVEN**: ids `power-mw`, `` (empty) and `señal`
- **WHEN**: exported
- **THEN**: they appear unquoted and unmodified

#### Scenario: Export parses back losslessly (property)
- **GIVEN**: a `fast-check` arbitrary of ids and finite/NaN/±Infinity Y values
- **WHEN**: the output is parsed by an RFC 4180 parser
- **THEN**: ids, X and Y values equal the originals (NaN compared as NaN)

### Requirement: Chunking Is Bounded and Chunk Boundaries Carry No Meaning
Each yielded chunk MUST be a string containing whole lines, and its size MUST be bounded
independently of `sampleCount` (design fixes the bound). Chunk boundaries MUST NOT affect the
concatenated bytes. String chunks are immutable and are not subject to the reused-buffer rule.

#### Scenario: Output is invariant to chunking
- **GIVEN**: the same export consumed with different internal chunk sizes (or a size-parameter variant, if exposed)
- **WHEN**: concatenated
- **THEN**: the bytes are identical

#### Scenario: Memory stays bounded for a large export
- **GIVEN**: a 1,000,000-sample trace consumed while discarding each chunk
- **WHEN**: the largest chunk length is measured
- **THEN**: it does not scale with `sampleCount`

### Requirement: CSV Export Is Core-Owned and DOM-Free
The CSV module MUST live in `@trace-kit/core`, MUST NOT reference DOM types or browser globals
(including `Blob`, `URL`, `TextEncoder`-free text only), and MUST be exercisable under the plain
`node` Vitest environment. It MUST add no dependency.

#### Scenario: Runs under node without DOM
- **GIVEN**: the CSV tests under the `node` environment
- **WHEN**: they run
- **THEN**: they pass with no DOM shim and no new package in `packages/core/package.json` dependencies
