import { exportCsv, exportNpy, type CsvTraceSource, type NpyArrayKind } from "@trace-kit/core";
import type { ScenarioFixture } from "@trace-kit/renderers/fixtures";

export interface RawDownloadOptions {
  /** Element the control row is appended to. */
  readonly parent: HTMLElement;
  /** The view's signal: every listener is registered on it, so aborting removes them all. */
  readonly signal: AbortSignal;
  /** The scenario currently shown; read on every download and refresh. */
  readonly getFixture: () => ScenarioFixture;
}

export interface RawDownload {
  /** Re-syncs the trace list and the window placeholders with the current scenario. */
  refresh(): void;
  /** Revokes any pending object URL, clears its timer and removes the control row. */
  dispose(): void;
}

interface PendingUrl {
  readonly url: string;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** Anything outside `[A-Za-z0-9._-]` becomes `_`, so the name is portable across file systems. */
function portableName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9._-]/g, "_");
}

/** A payload scenario is exported as a single trace named after the scenario. */
function sourceOf(fixture: ScenarioFixture): CsvTraceSource {
  return fixture.kind === "collection"
    ? fixture.collection
    : { entries: [{ id: fixture.id, payload: fixture.payload }] };
}

/** Empty (after trimming) means "use the scenario default"; anything else goes through `Number`. */
function parseBound(raw: string, fallback: number): number {
  const text = raw.trim();
  return text.length === 0 ? fallback : Number(text);
}

function textInput(label: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.size = 10;
  input.setAttribute("aria-label", label);
  return input;
}

function button(label: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  return element;
}

function select(label: string, values: readonly string[]): HTMLSelectElement {
  const element = document.createElement("select");
  element.setAttribute("aria-label", label);
  fillOptions(element, values);
  return element;
}

function fillOptions(element: HTMLSelectElement, values: readonly string[]): void {
  const previous = element.value;
  element.replaceChildren();
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    element.appendChild(option);
  }
  // Select explicitly: not every DOM leaves a freshly filled select on its first option.
  element.value = values.includes(previous) ? previous : (values[0] ?? "");
}

/**
 * Raw-data download row for the `/svg-export` view: an optional X window, a CSV download of the
 * whole scenario and a `.npy` download of one selected array. The window empty means the
 * scenario domain the view already draws, resolved strictly (no neighbour samples).
 *
 * Invalid window text reports an error and produces no file: silently falling back to the full
 * domain after a typo would hand over a plausible-looking but unrequested download.
 */
export function mountRawDownload(options: RawDownloadOptions): RawDownload {
  const { parent, signal, getFixture } = options;

  const row = document.createElement("div");
  row.style.cssText = "display:flex;flex-wrap:wrap;gap:1rem;align-items:center";

  const xMinInput = textInput("xMin");
  const xMaxInput = textInput("xMax");
  const csvButton = button("Download CSV");
  const traceSelect = select("Trace", []);
  const arraySelect = select("Array", ["x", "y"]);
  const npyButton = button("Download .npy");
  const status = document.createElement("output");
  status.setAttribute("role", "status");

  const xMinLabel = document.createElement("label");
  xMinLabel.append("xMin ", xMinInput);
  const xMaxLabel = document.createElement("label");
  xMaxLabel.append("xMax ", xMaxInput);
  row.append(xMinLabel, xMaxLabel, csvButton, traceSelect, arraySelect, npyButton, status);
  parent.appendChild(row);

  let pending: PendingUrl | null = null;

  function releasePending(): void {
    if (pending !== null) {
      clearTimeout(pending.timer);
      URL.revokeObjectURL(pending.url);
      pending = null;
    }
  }

  /**
   * The browser needs one task to start reading the blob after `click()`, hence the zero-delay
   * revoke; a superseding download or the unmount revokes earlier through `releasePending`.
   */
  function deliver(blob: Blob, fileName: string): void {
    releasePending();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      pending = null;
    }, 0);
    pending = { url, timer };
  }

  /** Returns the window, or reports the problem and returns `null`. */
  function readWindow(fixture: ScenarioFixture): { xMin: number; xMax: number } | null {
    const xMin = parseBound(xMinInput.value, fixture.domain.xMin);
    const xMax = parseBound(xMaxInput.value, fixture.domain.xMax);
    if (Number.isNaN(xMin)) {
      status.textContent = "xMin is not a number";
      return null;
    }
    if (Number.isNaN(xMax)) {
      status.textContent = "xMax is not a number";
      return null;
    }
    status.textContent = "";
    return { xMin, xMax };
  }

  function downloadCsv(): void {
    const fixture = getFixture();
    const window = readWindow(fixture);
    if (window === null) return;
    const parts: string[] = [];
    for (const chunk of exportCsv(sourceOf(fixture), window.xMin, window.xMax)) parts.push(chunk);
    deliver(new Blob(parts, { type: "text/csv" }), `${portableName(fixture.id)}.csv`);
  }

  function downloadNpy(): void {
    const fixture = getFixture();
    const window = readWindow(fixture);
    if (window === null) return;
    const traceId = traceSelect.value;
    const entry = sourceOf(fixture).entries.find((candidate) => candidate.id === traceId);
    if (entry === undefined) {
      status.textContent = "no trace to export";
      return;
    }
    const array: NpyArrayKind = arraySelect.value === "y" ? "y" : "x";
    // The writer reuses one scratch buffer: each chunk must be copied before the next `next()`.
    const parts: Uint8Array<ArrayBuffer>[] = [];
    for (const chunk of exportNpy(entry.payload, array, window.xMin, window.xMax)) {
      parts.push(chunk.slice());
    }
    deliver(
      new Blob(parts, { type: "application/octet-stream" }),
      `${portableName(fixture.id)}-${portableName(traceId)}-${array}.npy`,
    );
  }

  function refresh(): void {
    const fixture = getFixture();
    fillOptions(
      traceSelect,
      sourceOf(fixture).entries.map((entry) => entry.id),
    );
    xMinInput.placeholder = String(fixture.domain.xMin);
    xMaxInput.placeholder = String(fixture.domain.xMax);
  }

  csvButton.addEventListener("click", downloadCsv, { signal });
  npyButton.addEventListener("click", downloadNpy, { signal });
  refresh();

  return {
    refresh,
    dispose(): void {
      releasePending();
      row.remove();
    },
  };
}
