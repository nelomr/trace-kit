/**
 * `TraceCollection` — N `SpectrumDataPayload`s sharing one X domain, each bound to a
 * `YAxisRegistration.id`, with per-trace style. Composition over widening: the collection holds
 * payload references and never copies or resamples their buffers, because two sweeps rarely
 * share an identical sampling grid and forcing one buffer would be an implicit resampling
 * transformation. Frozen, replace-on-update: every mutating call returns a new collection with
 * `revision + 1`; a member payload's own `commitPayloadRevision` never touches this revision, so
 * a renderer can distinguish "this trace's data changed" from "this collection's shape changed"
 * without re-deriving one from the other.
 */
import type { SpectrumDataPayload } from "./spectrum-data-payload.js";
import type { YAxisRegistration } from "../viewport/axes.js";

/**
 * Per-trace style. Every field is optional and core defines no default: `color`, line width and
 * `markIsolatedSamples`'s "on" default are a rendering concern, resolved by the consumer that
 * actually draws pixels.
 */
export interface TraceStyle {
  readonly color?: string;
  readonly lineWidthCss?: number;
  readonly dash?: readonly number[];
  readonly markIsolatedSamples?: boolean;
}

export interface TraceEntry {
  readonly id: string;
  readonly payload: SpectrumDataPayload;
  readonly yAxisId: string;
  readonly style: TraceStyle;
}

export interface TraceCollection {
  readonly entries: readonly TraceEntry[];
  readonly xDomainMin: number;
  readonly xDomainMax: number;
  readonly revision: number;
}

/** Input shape for a single trace at construction or replacement time. */
export interface TraceCollectionEntryInput {
  readonly id: string;
  readonly payload: SpectrumDataPayload;
  readonly yAxisId: string;
  readonly style: TraceStyle;
}

/**
 * Validates every entry's `yAxisId` against `axes` and every entry's `id` for uniqueness before
 * anything is frozen — a local `Set` is a cold-path cost paid once per construction, not per
 * frame. Freezes the entry array, each entry, and each entry's style object; the collection
 * itself is frozen last.
 */
export function createTraceCollection(
  entries: readonly TraceCollectionEntryInput[],
  axes: readonly YAxisRegistration[],
  xDomainMin: number,
  xDomainMax: number,
): TraceCollection {
  return buildCollection(entries, axes, xDomainMin, xDomainMax, 0);
}

/**
 * Replaces `traceId`'s axis binding with `yAxisId` (re-validated against `axes`) and returns a
 * new frozen collection with `revision + 1`. Every other entry's reference is reused, not
 * recreated — only the rebound entry and the entries array are new objects.
 */
export function withTraceAxis(
  collection: TraceCollection,
  traceId: string,
  yAxisId: string,
  axes: readonly YAxisRegistration[],
): TraceCollection {
  const inputs = collection.entries.map((entry) =>
    entry.id === traceId ? { ...entry, yAxisId } : entry,
  );
  return buildCollection(
    inputs,
    axes,
    collection.xDomainMin,
    collection.xDomainMax,
    collection.revision + 1,
  );
}

/**
 * Replaces `traceId`'s style object wholesale and returns a new frozen collection with
 * `revision + 1`. Style replacement never touches axis validation, since style carries no axis
 * reference.
 */
export function withTraceStyle(
  collection: TraceCollection,
  traceId: string,
  style: TraceStyle,
): TraceCollection {
  const inputs = collection.entries.map((entry) =>
    entry.id === traceId ? { ...entry, style } : entry,
  );
  // Axis ids are already known-valid (this collection was itself constructed validly and no
  // axis binding changes here), but re-validating from the current entries keeps this function
  // independent of the axis list a caller might no longer have in hand: it derives its own
  // no-op-equivalent check from data already proven correct.
  return buildCollectionUnchecked(
    inputs,
    collection.xDomainMin,
    collection.xDomainMax,
    collection.revision + 1,
  );
}

function buildCollection(
  entries: readonly TraceCollectionEntryInput[],
  axes: readonly YAxisRegistration[],
  xDomainMin: number,
  xDomainMax: number,
  revision: number,
): TraceCollection {
  const knownAxisIds = new Set<string>();
  for (let i = 0; i < axes.length; i += 1) knownAxisIds.add(axes[i]!.id);

  const seenIds = new Set<string>();
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    if (seenIds.has(entry.id)) {
      throw new RangeError(`Duplicate trace id "${entry.id}" in a TraceCollection.`);
    }
    seenIds.add(entry.id);
    if (!knownAxisIds.has(entry.yAxisId)) {
      throw new RangeError(
        `Trace "${entry.id}" is bound to unknown yAxisId "${entry.yAxisId}".`,
      );
    }
  }

  return buildCollectionUnchecked(entries, xDomainMin, xDomainMax, revision);
}

function buildCollectionUnchecked(
  entries: readonly TraceCollectionEntryInput[],
  xDomainMin: number,
  xDomainMax: number,
  revision: number,
): TraceCollection {
  const frozenEntries: TraceEntry[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    const style: TraceStyle = Object.freeze({ ...entry.style });
    const frozenEntry: TraceEntry = Object.freeze({
      id: entry.id,
      payload: entry.payload,
      yAxisId: entry.yAxisId,
      style,
    });
    frozenEntries.push(frozenEntry);
  }

  return Object.freeze({
    entries: Object.freeze(frozenEntries),
    xDomainMin,
    xDomainMax,
    revision,
  });
}

/**
 * Resolves each entry's `yAxisId` to its index in `axes` by a nested linear scan, writing into
 * the caller-owned `out`. Trace and axis counts are small (single digits to low tens), so the
 * O(entries * axes) scan is cheaper — and, critically, allocation-free — than building and
 * discarding a `Map` every time a collection or axis set changes. Called once per collection
 * revision (`setTraces`, axis change), never per point or per frame.
 */
export function resolveTraceAxisIndices(
  collection: TraceCollection,
  axes: readonly YAxisRegistration[],
  out: Int32Array,
): number {
  const entries = collection.entries;
  for (let i = 0; i < entries.length; i += 1) {
    const yAxisId = entries[i]!.yAxisId;
    let foundIndex = -1;
    for (let a = 0; a < axes.length; a += 1) {
      if (axes[a]!.id === yAxisId) {
        foundIndex = a;
        break;
      }
    }
    out[i] = foundIndex;
  }
  return entries.length;
}
