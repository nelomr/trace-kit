import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pane } from "tweakpane";
import type { TraceDrawingContext } from "@trace-kit/renderers";
import { SCENARIO_FIXTURES } from "@trace-kit/renderers/fixtures";
import { TRACEKIT_INTER_EMBEDDED_FONT } from "@trace-kit/renderers/font";
import { exportToSvg } from "@trace-kit/renderers/svg";
import { asRoutePath } from "../../src/shell/view.js";
import { registeredViews, resolveView } from "../../src/shell/registry.js";
import { mount, sceneFromFixture } from "../../src/views/svg-export/mount.js";

// Tracks every renderer the view constructs and whether it was disposed, through the real class.
const renderers = vi.hoisted((): Array<{ disposed: () => boolean }> => []);

vi.mock("@trace-kit/renderers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@trace-kit/renderers")>();
  class TrackingCanvas2DRenderer extends actual.Canvas2DRenderer {
    constructor(options: ConstructorParameters<typeof actual.Canvas2DRenderer>[0]) {
      super(options);
      renderers.push({ disposed: () => this.disposed });
    }
  }
  return { ...actual, Canvas2DRenderer: TrackingCanvas2DRenderer };
});

class StubPath2D {
  moveTo(): void {}
  lineTo(): void {}
  rect(): void {}
}

interface Created {
  readonly url: string;
  readonly blob: Blob;
}

let created: Created[];
let revoked: string[];
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
let originalPath2D: typeof globalThis.Path2D;
let originalCreate: typeof URL.createObjectURL;
let originalRevoke: typeof URL.revokeObjectURL;

beforeEach(() => {
  created = [];
  revoked = [];
  renderers.length = 0;
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

  // eslint-disable-next-line @typescript-eslint/unbound-method
  originalCreate = URL.createObjectURL;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (blob: Blob): string => {
    const url = `blob:svg-export-test/${created.length}`;
    created.push({ url, blob });
    return url;
  };
  URL.revokeObjectURL = (url: string): void => {
    revoked.push(url);
  };
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  globalThis.Path2D = originalPath2D;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

function mounted() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const controller = new AbortController();
  const teardown = mount({ container, panel: new Pane(), signal: controller.signal });
  const select = container.querySelector("select");
  const canvas = container.querySelector("canvas");
  const image = container.querySelector("img");
  const download = container.querySelector("a");
  const target = container.querySelector<HTMLInputElement>('input[type="number"]');
  const font = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!select || !canvas || !image || !download || !target || !font) throw new Error("view is missing a control");
  return { container, controller, teardown, select, canvas, image, download, target, font };
}

async function lastText(): Promise<string> {
  const last = created[created.length - 1];
  if (last === undefined) throw new Error("no object URL was created");
  return last.blob.text();
}

function fixtureAt(index: number) {
  const fixture = SCENARIO_FIXTURES[index];
  if (fixture === undefined) throw new Error(`no fixture ${index}`);
  return fixture;
}

describe("/svg-export registration", () => {
  it("registers through registerView at /svg-export with one import line and no shell edit", async () => {
    await import("../../src/views/index.js");
    const view = resolveView(asRoutePath("/svg-export"));
    expect(view?.label).toBe("SVG Export");
    expect(registeredViews().filter((v) => v.path === "/svg-export").length).toBe(1);

    const here = path.dirname(fileURLToPath(import.meta.url));
    const index = readFileSync(path.join(here, "../../src/views/index.ts"), "utf8");
    expect(index.match(/svg-export/g)?.length).toBe(1);
    for (const shellFile of ["router.ts", "registry.ts", "bootstrap.ts", "view.ts"]) {
      expect(readFileSync(path.join(here, "../../src/shell", shellFile), "utf8")).not.toContain("svg-export");
    }
    const home = readFileSync(path.join(here, "../../src/views/home/mount.ts"), "utf8");
    expect(home).not.toContain("svg-export");
  });

  it("appears as a link on the landing view", async () => {
    await import("../../src/views/index.js");
    const { mount: mountHome } = await import("../../src/views/home/mount.js");
    const container = document.createElement("div");
    const teardown = mountHome({ container, panel: new Pane(), signal: new AbortController().signal });
    const links = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).toContain("#/svg-export");
    void teardown();
  });
});

describe("/svg-export view", () => {
  it("shows a canvas and an image of the exported document, sized identically", async () => {
    const view = mounted();
    expect(view.select.options.length).toBe(SCENARIO_FIXTURES.length);
    expect(Array.from(view.select.options).map((o) => o.value)).toEqual(SCENARIO_FIXTURES.map((f) => f.id));
    expect(view.canvas.style.width).toBe("800px");
    expect(view.canvas.style.height).toBe("400px");
    expect(view.image.style.width).toBe(view.canvas.style.width);
    expect(view.image.style.height).toBe(view.canvas.style.height);
    expect(created.length).toBe(1);
    expect(view.image.getAttribute("src")).toBe(created[0]?.url);
    expect(created[0]?.blob.type).toBe("image/svg+xml");
    expect(await lastText()).toBe(exportToSvg(sceneFromFixture(fixtureAt(0))));
    expect(renderers.length).toBeGreaterThanOrEqual(1);
    await view.teardown();
  });

  it("defaults reproduce the committed golden for a parity scenario", async () => {
    const view = mounted();
    const here = path.dirname(fileURLToPath(import.meta.url));
    const golden = readFileSync(
      path.join(here, "../../../../packages/renderers/test/svg-goldens", `${fixtureAt(0).id}.svg`),
      "utf8",
    );
    expect(await lastText()).toBe(golden);
    await view.teardown();
  });

  it("re-renders both panes and revokes the superseded URL when the scenario changes", async () => {
    const view = mounted();
    const first = created[0]?.url;
    const rendererCount = renderers.length;
    const next = fixtureAt(SCENARIO_FIXTURES.length - 1);
    view.select.value = next.id;
    view.select.dispatchEvent(new Event("change"));

    expect(revoked).toEqual([first]);
    expect(created.length).toBe(2);
    expect(await lastText()).toBe(exportToSvg(sceneFromFixture(next)));
    expect(view.download.getAttribute("download")).toBe(`${next.id}.svg`);
    expect(renderers.length).toBe(rendererCount + 1);
    expect(renderers[rendererCount - 1]?.disposed()).toBe(true);
    await view.teardown();
  });

  it("re-exports on a decimationTarget change, and an empty field means the default", async () => {
    const view = mounted();
    const fixture = fixtureAt(0);
    view.target.value = "50";
    view.target.dispatchEvent(new Event("input"));
    expect(await lastText()).toBe(exportToSvg(sceneFromFixture(fixture), { decimationTarget: 50 }));
    expect(revoked.length).toBe(1);

    view.target.value = "";
    view.target.dispatchEvent(new Event("input"));
    expect(await lastText()).toBe(exportToSvg(sceneFromFixture(fixture)));
    expect(revoked.length).toBe(2);
    await view.teardown();
  });

  it("embeds the font only when the checkbox is switched on", async () => {
    const view = mounted();
    expect(view.font.checked).toBe(false);
    expect(await lastText()).not.toContain("@font-face");

    view.font.checked = true;
    view.font.dispatchEvent(new Event("change"));
    const text = await lastText();
    expect(text.match(/@font-face/g)?.length).toBe(1);
    expect(text).toBe(exportToSvg(sceneFromFixture(fixtureAt(0)), { embedFont: TRACEKIT_INTER_EMBEDDED_FONT }));
    expect(revoked.length).toBe(1);
    await view.teardown();
  });

  it("offers a download of exactly the displayed document, reusing its object URL", async () => {
    const view = mounted();
    const current = created[created.length - 1];
    expect(view.download.getAttribute("href")).toBe(current?.url);
    expect(view.download.getAttribute("download")).toBe(`${fixtureAt(0).id}.svg`);
    expect(current?.blob.type).toBe("image/svg+xml");
    expect(await current?.blob.text()).toBe(exportToSvg(sceneFromFixture(fixtureAt(0))));
    expect(revoked).toEqual([]);
    await view.teardown();
    expect(revoked).toEqual([current?.url]);
  });

  it("leaves nothing behind after unmount", async () => {
    const view = mounted();
    view.select.value = fixtureAt(2).id;
    view.select.dispatchEvent(new Event("change"));
    view.target.value = "40";
    view.target.dispatchEvent(new Event("input"));

    view.controller.abort();
    await view.teardown();

    expect(view.container.querySelector("canvas, img, select, a, input")).toBeNull();
    expect(new Set(revoked)).toEqual(new Set(created.map((c) => c.url)));
    expect(revoked.length).toBe(created.length);
    expect(renderers.every((r) => r.disposed())).toBe(true);

    const before = created.length;
    view.select.dispatchEvent(new Event("change"));
    view.target.dispatchEvent(new Event("input"));
    expect(created.length).toBe(before);
  });
});
