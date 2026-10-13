import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { Pane } from "tweakpane";
import { exportCsv, exportNpy } from "@trace-kit/core";
import type { TraceDrawingContext } from "@trace-kit/renderers";
import { SCENARIO_FIXTURES, type ScenarioFixture } from "@trace-kit/renderers/fixtures";
import { mountRawDownload, type RawDownload } from "../../src/views/svg-export/raw-download.js";
import { mount } from "../../src/views/svg-export/mount.js";

class StubPath2D {
  moveTo(): void {}
  lineTo(): void {}
  rect(): void {}
}

interface Created {
  readonly url: string;
  readonly blob: Blob;
}
interface Clicked {
  readonly href: string;
  readonly download: string;
}

let created: Created[];
let revoked: string[];
let clicked: Clicked[];
let originalCreate: typeof URL.createObjectURL;
let originalRevoke: typeof URL.revokeObjectURL;
let clickSpy: MockInstance<HTMLAnchorElement["click"]>;

beforeEach(() => {
  created = [];
  revoked = [];
  clicked = [];
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  // eslint-disable-next-line @typescript-eslint/unbound-method
  originalCreate = URL.createObjectURL;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (blob: Blob): string => {
    const url = `blob:raw-download-test/${String(created.length)}`;
    created.push({ url, blob });
    return url;
  };
  URL.revokeObjectURL = (url: string): void => {
    revoked.push(url);
  };
  // happy-dom would try to navigate to the blob URL; the capture also records the file name.
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ): void {
    clicked.push({ href: this.href, download: this.download });
  });
});

afterEach(() => {
  clickSpy.mockRestore();
  vi.useRealTimers();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

function fixtureById(id: string): ScenarioFixture {
  const fixture = SCENARIO_FIXTURES.find((f) => f.id === id);
  if (fixture === undefined) throw new Error(`no fixture ${id}`);
  return fixture;
}

function sourceOf(fixture: ScenarioFixture) {
  return fixture.kind === "collection"
    ? fixture.collection
    : { entries: [{ id: fixture.id, payload: fixture.payload }] };
}

interface Mounted {
  readonly parent: HTMLElement;
  readonly controller: AbortController;
  readonly control: RawDownload;
  readonly xMin: HTMLInputElement;
  readonly xMax: HTMLInputElement;
  readonly csvButton: HTMLButtonElement;
  readonly npyButton: HTMLButtonElement;
  readonly trace: HTMLSelectElement;
  readonly array: HTMLSelectElement;
  readonly status: HTMLOutputElement;
  fixture: ScenarioFixture;
}

function mountControl(initial: ScenarioFixture): Mounted {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const controller = new AbortController();
  const state = { fixture: initial };
  const control = mountRawDownload({
    parent,
    signal: controller.signal,
    getFixture: () => state.fixture,
  });
  const byLabel = <T extends HTMLElement>(label: string): T => {
    const element = parent.querySelector<T>(`[aria-label="${label}"]`);
    if (element === null) throw new Error(`missing control ${label}`);
    return element;
  };
  const buttons = Array.from(parent.querySelectorAll("button"));
  const csvButton = buttons.find((b) => b.textContent === "Download CSV");
  const npyButton = buttons.find((b) => b.textContent === "Download .npy");
  const status = parent.querySelector("output");
  if (csvButton === undefined || npyButton === undefined || status === null) {
    throw new Error("raw download control is incomplete");
  }
  return {
    parent,
    controller,
    control,
    xMin: byLabel<HTMLInputElement>("xMin"),
    xMax: byLabel<HTMLInputElement>("xMax"),
    csvButton,
    npyButton,
    trace: byLabel<HTMLSelectElement>("Trace"),
    array: byLabel<HTMLSelectElement>("Array"),
    status,
    get fixture() {
      return state.fixture;
    },
    set fixture(value: ScenarioFixture) {
      state.fixture = value;
    },
  };
}

function joinChunks(chunks: Iterable<string>): string {
  let out = "";
  for (const chunk of chunks) out += chunk;
  return out;
}

function copiedBytes(chunks: Iterable<Uint8Array>): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const chunk of chunks) {
    const copy = chunk.slice();
    parts.push(copy);
    total += copy.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function lastBlobBytes(): Promise<Uint8Array> {
  const last = created[created.length - 1];
  if (last === undefined) throw new Error("no object URL was created");
  return new Uint8Array(await last.blob.arrayBuffer());
}

describe("raw download: CSV", () => {
  it("downloads the joined exporter output for a payload scenario, as text/csv", async () => {
    const fixture = fixtureById("gapped-trace");
    const view = mountControl(fixture);
    view.csvButton.click();

    expect(created.length).toBe(1);
    expect(created[0]?.blob.type).toBe("text/csv");
    expect(await created[0]?.blob.text()).toBe(
      joinChunks(exportCsv(sourceOf(fixture), fixture.domain.xMin, fixture.domain.xMax)),
    );
    expect(clicked).toEqual([{ href: created[0]?.url, download: "gapped-trace.csv" }]);
  });

  it("downloads the collection scenario through the collection source", async () => {
    const fixture = fixtureById("overlay-two-axis");
    const view = mountControl(fixture);
    view.csvButton.click();
    const text = (await created[0]?.blob.text()) ?? "";
    expect(text).toBe(joinChunks(exportCsv(sourceOf(fixture), fixture.domain.xMin, fixture.domain.xMax)));
    // The second trace sits at xOrigin 1000, outside this scenario's 0..299 domain: skipped.
    expect(text).toContain("\nlinear-trace,");
    expect(text).not.toContain("log-trace,");
  });

  it("narrows every downloaded row to the typed window", async () => {
    const view = mountControl(fixtureById("noise-floor"));
    view.xMin.value = "10";
    view.xMax.value = "20";
    view.csvButton.click();
    const rows = ((await created[0]?.blob.text()) ?? "").trim().split("\n").slice(1);
    expect(rows.length).toBe(11);
    for (const row of rows) {
      const x = Number(row.split(",")[1]);
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThanOrEqual(20);
    }
  });

  it("treats empty or blank inputs as the scenario domain", async () => {
    const fixture = fixtureById("gapped-trace");
    const view = mountControl(fixture);
    view.xMin.value = "   ";
    view.xMax.value = "";
    view.csvButton.click();
    expect(await created[0]?.blob.text()).toBe(
      joinChunks(exportCsv(sourceOf(fixture), fixture.domain.xMin, fixture.domain.xMax)),
    );
  });

  it("accepts infinite bounds and exports a header only for an inverted window", async () => {
    const view = mountControl(fixtureById("gapped-trace"));
    view.xMin.value = "-Infinity";
    view.xMax.value = "Infinity";
    view.csvButton.click();
    expect(((await created[0]?.blob.text()) ?? "").split("\n").length).toBeGreaterThan(500);

    view.xMin.value = "300";
    view.xMax.value = "100";
    view.csvButton.click();
    expect(await created[1]?.blob.text()).toBe("trace_id,x,y\n");
    expect(view.status.textContent).toBe("");
  });
});

describe("raw download: .npy", () => {
  it("downloads the copied chunks of the writer, with the magic, MIME type and file name", async () => {
    const fixture = fixtureById("overlay-two-axis");
    const view = mountControl(fixture);
    view.trace.value = "linear-trace";
    view.array.value = "y";
    view.npyButton.click();

    const entry = fixture.kind === "collection" ? fixture.collection.entries[0] : undefined;
    if (entry === undefined) throw new Error("fixture shape changed");
    const reference = copiedBytes(
      exportNpy(entry.payload, "y", fixture.domain.xMin, fixture.domain.xMax),
    );
    const bytes = await lastBlobBytes();
    expect(created[0]?.blob.type).toBe("application/octet-stream");
    expect(Array.from(bytes.subarray(0, 8))).toEqual([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 0x01, 0x00]);
    expect(Array.from(bytes)).toEqual(Array.from(reference));
    expect(clicked[0]?.download).toBe("overlay-two-axis-linear-trace-y.npy");
  });

  it("reduces the trace id to portable file-name characters", () => {
    const base = fixtureById("gapped-trace");
    const view = mountControl({ ...base, id: "we ird/id:1" });
    view.npyButton.click();
    expect(clicked[0]?.download).toBe("we_ird_id_1-we_ird_id_1-x.npy");
  });

  it("does not alias chunks of a multi-chunk export", async () => {
    const fixture = fixtureById("decimation-minmax");
    const view = mountControl(fixture);
    view.npyButton.click();
    const bytes = await lastBlobBytes();
    // The reference is one chunk large enough to hold the whole file: no scratch reuse at all.
    const payload = fixture.kind === "payload" ? fixture.payload : undefined;
    if (payload === undefined) throw new Error("fixture shape changed");
    const reference = copiedBytes(
      exportNpy(payload, "x", fixture.domain.xMin, fixture.domain.xMax, { chunkBytes: 4_000_000 }),
    );
    expect(bytes.length).toBeGreaterThan(65536 * 2);
    expect(bytes.length).toBe(reference.length);
    expect(bytes.every((byte, i) => byte === reference[i])).toBe(true);
  });

  it("exports a (0,) array for an inverted window", async () => {
    const view = mountControl(fixtureById("gapped-trace"));
    view.xMin.value = "300";
    view.xMax.value = "100";
    view.npyButton.click();
    const bytes = await lastBlobBytes();
    expect(bytes.length).toBe(128);
    expect(new TextDecoder().decode(bytes.subarray(10))).toContain("'shape': (0,)");
  });
});

describe("raw download: invalid input", () => {
  it.each([
    ["xMin", "abc", ""],
    ["xMax", "", "12x"],
  ])("reports a non-numeric %s and produces no file", (name, minText, maxText) => {
    const view = mountControl(fixtureById("gapped-trace"));
    view.xMin.value = minText;
    view.xMax.value = maxText;
    expect(() => {
      view.csvButton.click();
      view.npyButton.click();
    }).not.toThrow();
    expect(view.status.textContent).toBe(`${name} is not a number`);
    expect(created).toEqual([]);
    expect(clicked).toEqual([]);
  });

  it("clears the error once a valid download succeeds", () => {
    const view = mountControl(fixtureById("gapped-trace"));
    view.xMin.value = "abc";
    view.csvButton.click();
    expect(view.status.textContent).not.toBe("");
    view.xMin.value = "";
    view.csvButton.click();
    expect(view.status.textContent).toBe("");
    expect(created.length).toBe(1);
  });
});

describe("raw download: object URL lifecycle", () => {
  it("revokes a URL on a timer after the click", () => {
    const view = mountControl(fixtureById("gapped-trace"));
    view.csvButton.click();
    expect(revoked).toEqual([]);
    vi.runAllTimers();
    expect(revoked).toEqual([created[0]?.url]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("revokes a pending URL immediately when a new download supersedes it", () => {
    const view = mountControl(fixtureById("gapped-trace"));
    view.csvButton.click();
    view.npyButton.click();
    expect(revoked).toEqual([created[0]?.url]);
    expect(vi.getTimerCount()).toBe(1);
    vi.runAllTimers();
    expect(new Set(revoked)).toEqual(new Set(created.map((c) => c.url)));
    expect(revoked.length).toBe(created.length);
  });

  it("releases the pending URL and its timer at dispose", () => {
    const view = mountControl(fixtureById("gapped-trace"));
    view.csvButton.click();
    view.control.dispose();
    expect(revoked).toEqual([created[0]?.url]);
    expect(vi.getTimerCount()).toBe(0);
    expect(view.parent.querySelector("button, input, select, output")).toBeNull();
  });
});

describe("raw download: scenario changes", () => {
  it("repopulates the trace list and the placeholders on refresh", () => {
    const view = mountControl(fixtureById("gapped-trace"));
    expect(Array.from(view.trace.options).map((o) => o.value)).toEqual(["gapped-trace"]);
    expect(view.xMin.placeholder).toBe("0");
    expect(view.xMax.placeholder).toBe("512");

    view.fixture = fixtureById("overlay-two-axis");
    view.control.refresh();
    expect(Array.from(view.trace.options).map((o) => o.value)).toEqual(["linear-trace", "log-trace"]);
    expect(view.xMax.placeholder).toBe("299");
  });
});

describe("raw download: balanced lifecycle", () => {
  it("registers every listener on the view's AbortSignal and goes quiet after abort", () => {
    // happy-dom elements may not inherit from the global EventTarget: spy where the method lives.
    let owner: object | null = Object.getPrototypeOf(document.createElement("button")) as object | null;
    while (owner !== null && !Object.hasOwn(owner, "addEventListener")) {
      owner = Object.getPrototypeOf(owner) as object | null;
    }
    if (owner === null) throw new Error("addEventListener owner not found");
    const spy = vi.spyOn(owner as EventTarget, "addEventListener");
    const view = mountControl(fixtureById("gapped-trace"));
    const own = spy.mock.calls.filter((_, index) => {
      const context: unknown = spy.mock.contexts[index];
      return context instanceof Node && view.parent.contains(context);
    });
    spy.mockRestore();
    expect(own.length).toBeGreaterThanOrEqual(2);
    for (const call of own) {
      const options = call[2];
      expect(typeof options === "object" && options !== null && "signal" in options).toBe(true);
    }

    const csv = view.csvButton;
    const npy = view.npyButton;
    view.controller.abort();
    view.control.dispose();
    csv.click();
    npy.click();
    expect(created).toEqual([]);
  });
});

describe("raw download: wired into the /svg-export view", () => {
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let originalPath2D: typeof globalThis.Path2D;

  beforeEach(() => {
    originalPath2D = globalThis.Path2D;
    // eslint-disable-next-line no-restricted-syntax -- happy-dom provides no Path2D
    globalThis.Path2D = StubPath2D as unknown as typeof Path2D;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    const context: TraceDrawingContext = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineJoin: "miter",
      font: "",
      textAlign: "left",
      textBaseline: "alphabetic",
      setTransform(): void {},
      fillRect(): void {},
      beginPath(): void {},
      moveTo(): void {},
      lineTo(): void {},
      stroke(): void {},
      setLineDash(): void {},
      fill(): void {},
      fillText(): void {},
    };
    // eslint-disable-next-line no-restricted-syntax -- happy-dom has no 2D canvas backend
    HTMLCanvasElement.prototype.getContext = (() => context) as unknown as typeof originalGetContext;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    globalThis.Path2D = originalPath2D;
  });

  it("downloads the selected scenario, follows scenario changes and leaves nothing behind", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const controller = new AbortController();
    const teardown = mount({ container, panel: new Pane(), signal: controller.signal });

    const scenario = container.querySelector("select");
    const csv = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Download CSV");
    if (scenario === null || csv === undefined) throw new Error("download control is not mounted");

    const svgUrls = created.length;
    scenario.value = "overlay-two-axis";
    scenario.dispatchEvent(new Event("change"));
    const traceSelect = container.querySelector<HTMLSelectElement>('[aria-label="Trace"]');
    expect(Array.from(traceSelect?.options ?? []).map((o) => o.value)).toEqual(["linear-trace", "log-trace"]);

    const before = created.length;
    csv.click();
    expect(created.length).toBe(before + 1);
    expect(created[before]?.blob.type).toBe("text/csv");
    expect(clicked[0]?.download).toBe("overlay-two-axis.csv");
    expect(before).toBeGreaterThan(svgUrls);

    controller.abort();
    await teardown();
    vi.runAllTimers();
    expect(container.querySelector("button, output")).toBeNull();
    expect(new Set(revoked)).toEqual(new Set(created.map((c) => c.url)));
    expect(revoked.length).toBe(created.length);
    expect(vi.getTimerCount()).toBe(0);
  });
});
