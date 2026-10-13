# Capability: binary-export-contract

> Change: `raw-data-viewport-export` (roadmap `order: 6.5`). New capability.
>
> Source: `proposal.md` Approach 3 and 4, Risks (`.npy` header, buffer aliasing).

## ADDED Requirements

### Requirement: A Binary Array Export Contract Is a Synchronous Byte-Chunk Generator
`@trace-kit/core` MUST export from its root entry the type `BinaryArrayExport`, describing a binary array export: a
synchronous generator yielding `Uint8Array` chunks, the first carrying the format header and the
rest carrying the data, one export per array (one file per array). The contract MUST be
format-agnostic so that other formats may implement it later, and MUST NOT mention HDF5 or `.npz`
beyond documenting them as deferred.

#### Scenario: The contract is implemented by the npy writer
- **GIVEN**: the exported contract type and the `.npy` writer
- **WHEN**: the writer is assigned to a value of the contract type under `tsc --noEmit`
- **THEN**: it typechecks

#### Scenario: Synchronous only
- **GIVEN**: a created export
- **WHEN**: `next()` is called
- **THEN**: it returns a plain `IteratorResult`, not a `Promise`

### Requirement: A Yielded Byte Chunk Is Valid Only Until the Next `next()`
Implementations MAY yield chunks backed by a reused scratch buffer. The contract's documentation
MUST state: a yielded byte chunk is valid only until the next `next()` call; consumers MUST copy or
consume it before advancing. Consumers that retain chunks without copying are outside the contract.

#### Scenario: Copying consumers get correct bytes
- **GIVEN**: a multi-chunk export consumed by copying each chunk (e.g. `slice()`) before advancing
- **WHEN**: the copies are concatenated
- **THEN**: they equal the reference bytes of the file

#### Scenario: Non-copying retention demonstrates aliasing
- **GIVEN**: a multi-chunk export (more samples than one chunk) whose yielded `Uint8Array` references are retained without copying
- **WHEN**: the generator is exhausted and the retained references are concatenated
- **THEN**: the result differs from the reference bytes, demonstrating why the documented rule exists (the test asserts the contract documents this rule)

#### Scenario: Documentation states the rule
- **GIVEN**: the contract type's JSDoc
- **WHEN**: inspected
- **THEN**: it contains the validity rule above

### Requirement: The `.npy` Writer Emits NumPy Format v1.0, Little-Endian, One File Per Array
The concrete writer `exportNpy` MUST emit a valid NumPy `.npy` version 1.0 file per array, as the byte
concatenation of its chunks. The X array MUST be dtype `<f8` holding absolute values
`xOrigin + x[i]` computed in f64. The Y array MUST keep its stored dtype (`<f4` for the current
branded Float32 buffers), values written unmodified (`NaN` gaps and `±Infinity` preserved as IEEE 754
bit patterns). Both MUST be one-dimensional, C-order. Data MUST cover exactly the resolved window
span. Multi-byte values MUST be little-endian regardless of the host's endianness.

#### Scenario: X is absolute f64
- **GIVEN**: `xOrigin = 1550`, one sample with offset `Math.fround(0.123456)`
- **WHEN**: the X `.npy` is produced
- **THEN**: its data is one little-endian f64 equal to `1550 + Math.fround(0.123456)`

#### Scenario: Y keeps its stored dtype and bits
- **GIVEN**: Y `[1.5, NaN, Infinity, -0]` as Float32
- **WHEN**: the Y `.npy` is produced
- **THEN**: descr is `<f4` and the data bytes are the little-endian f32 representation, with `NaN` as a NaN pattern, `Infinity` as `0x7F800000` and `-0` as `0x80000000`

#### Scenario: Only the window is written
- **GIVEN**: a payload of 10 samples and a window resolving to `{ start: 3, end: 7 }`
- **WHEN**: both arrays are produced
- **THEN**: each header shape is `(4,)` and each data section holds 4 elements, aligned (same index = same sample)

#### Scenario: Neighbour option is honored
- **GIVEN**: the same window with the neighbour option enabled
- **WHEN**: produced
- **THEN**: shapes reflect the extended span

#### Scenario: Output is host-endianness independent
- **GIVEN**: the writer's data path
- **WHEN**: its implementation is inspected or run with an explicit `DataView` little-endian write path
- **THEN**: bytes equal the little-endian reference regardless of platform byte order

### Requirement: The `.npy` Header Is Byte-Exact
The file MUST start with the 6 magic bytes `0x93 4E 55 4D 50 59` (`\x93NUMPY`), then major version
`0x01` and minor version `0x00`, then `HEADER_LEN` as an unsigned 16-bit little-endian integer,
then the header string, then the data. The header string MUST be the ASCII Python dict literal
`{'descr': '<DT>', 'fortran_order': False, 'shape': (N,), }` where `<DT>` is `<f8` or `<f4`,
`N` is the decimal element count (the one-element tuple has a trailing comma, so zero samples is
`(0,)`), followed by space (`0x20`) padding and a terminating `\n` (`0x0A`), such that
`10 + HEADER_LEN` is a multiple of 64. Padding MUST be the minimal that satisfies this. The header
string MUST be ASCII only.

#### Scenario: Byte-level header for three f8 samples
- **GIVEN**: X of three samples
- **WHEN**: the first chunk (header) is read
- **THEN**: bytes `0..5` are `93 4E 55 4D 50 59`, byte 6 is `01`, byte 7 is `00`, bytes `8..9` are `76 00` (`HEADER_LEN = 118`), bytes `10..` are the ASCII of `{'descr': '<f8', 'fortran_order': False, 'shape': (3,), }` (57 chars), then 60 bytes of `0x20`, then `0x0A`; total header chunk length is 128 bytes, and the header is followed immediately by 24 data bytes

#### Scenario: Byte-level header for three f4 samples
- **GIVEN**: Y of three samples
- **WHEN**: the header is read
- **THEN**: identical to the previous scenario except the dict contains `'<f4'`, with the same 128-byte length, followed by 12 data bytes

#### Scenario: Zero-sample array
- **GIVEN**: an empty span
- **WHEN**: the `.npy` is produced
- **THEN**: the header contains `'shape': (0,)`, `10 + HEADER_LEN` is a multiple of 64, and the file ends after the header (no data bytes)

#### Scenario: Alignment holds for varied shapes
- **GIVEN**: element counts `0, 1, 9, 99, 1000, 123456789`
- **WHEN**: headers are produced for both dtypes
- **THEN**: `(10 + HEADER_LEN) % 64 === 0`, the header ends in `0x0A` and preceded only by spaces after the dict's closing `}`

#### Scenario: NumPy loads the committed fixtures
- **GIVEN**: committed `.npy` fixture files produced by the writer for a known array (generated once and loaded with NumPy `numpy.load` in a documented offline check, with the expected values recorded alongside)
- **WHEN**: the writer is run again in the unit tests
- **THEN**: its bytes equal the committed fixtures exactly

### Requirement: HDF5 and `.npz` Are Explicit Deferrals
The change MUST NOT implement HDF5, `.npz`/zip bundles, MATLAB `.mat` or Parquet, and MUST NOT add
a dependency for them. The contract documentation MUST name them as deferred.

#### Scenario: No deferred format is exported
- **GIVEN**: `@trace-kit/core`'s export surface
- **WHEN**: inspected
- **THEN**: no HDF5, `.npz`, `.mat` or Parquet writer exists

#### Scenario: No new dependency
- **GIVEN**: `packages/core/package.json`
- **WHEN**: diffed against the previous version
- **THEN**: `dependencies` is unchanged

### Requirement: Streaming Writer Is Bounded, Allocation-Disciplined and Isomorphic
The data section MUST be produced in chunks of bounded size independent of `sampleCount`, reusing
one scratch buffer rather than allocating a buffer per chunk. Chunk boundaries MUST NOT affect the
concatenated bytes. The module MUST live in `@trace-kit/core`, MUST NOT reference DOM types or
browser globals (including `Blob`), and MUST run under the plain `node` Vitest environment. Typed
buffers MUST NOT be wrapped in reactive structures and MUST NOT be placed in a transfer list by this
module.

#### Scenario: Large export reuses its scratch buffer
- **GIVEN**: a 1,000,000-sample export consumed while recording each chunk's `buffer` identity
- **WHEN**: the generator is exhausted
- **THEN**: the data chunks share a bounded number of distinct `ArrayBuffer`s (not one per chunk)

#### Scenario: Bytes are invariant to chunk size
- **GIVEN**: the same array exported with different internal chunk sizes (or a size-parameter variant, if exposed)
- **WHEN**: concatenated
- **THEN**: bytes are identical

#### Scenario: No DOM reference
- **GIVEN**: the module and its imports
- **WHEN**: inspected and run under `node`
- **THEN**: no DOM type or global is referenced and no DOM shim is required
