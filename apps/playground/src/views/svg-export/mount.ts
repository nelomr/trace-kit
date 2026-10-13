import { Canvas2DRenderer } from "@trace-kit/renderers";
import { SCENARIO_FIXTURES, type ScenarioFixture } from "@trace-kit/renderers/fixtures";
import { ensureDefaultFont, TRACEKIT_INTER_EMBEDDED_FONT } from "@trace-kit/renderers/font";
import { exportToSvg, type SvgExportOptions, type SvgScene } from "@trace-kit/renderers/svg";
import type { ViewHost, ViewTeardown } from "../../shell/view.js";
import { mountRawDownload } from "./raw-download.js";

/**
 * Maps a backend-free fixture to an exporter scene: the CSS-pixel viewport becomes the document
 * size, `dpr` is ignored (SVG coordinates are CSS pixels) and the data, domain and axes pass
 * through. Kept here, not in the fixtures module, so fixtures stay free of any exporter type.
 */
export function sceneFromFixture(fixture: ScenarioFixture): SvgScene {
  return {
    traces: fixture.kind === "payload" ? fixture.payload : fixture.collection,
    domain: fixture.domain,
    width: fixture.viewport.width,
    height: fixture.viewport.height,
    ...(fixture.yAxes === undefined ? {} : { yAxes: fixture.yAxes }),
  };
}

/** An empty or non-numeric field means "use the exporter's width-derived default". */
function parseDecimationTarget(raw: string): number | undefined {
  if (raw.trim().length === 0) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The `/svg-export` view: one shared fixture drawn by `Canvas2DRenderer` on a canvas and by
 * `exportToSvg` into an `<img>`, side by side at the same CSS size, so any drift between the two
 * backends is visible by eye. Fixtures stay module constants (no reactive wrapper) because their
 * typed-array buffers must never be proxied.
 *
 * Every object URL created for the exported document is revoked as soon as it is superseded
 * (scenario change, option change) and at unmount, so the view never accumulates Blob URLs.
 */
export function mount(host: ViewHost): ViewTeardown {
  const { signal } = host;

  const root = document.createElement("div");
  root.style.cssText = "display:flex;flex-direction:column;gap:1rem;padding:1rem;font-family:system-ui,sans-serif";

  const controls = document.createElement("div");
  controls.style.cssText = "display:flex;flex-wrap:wrap;gap:1rem;align-items:center";

  const select = document.createElement("select");
  select.setAttribute("aria-label", "Scenario");
  for (const fixture of SCENARIO_FIXTURES) {
    const option = document.createElement("option");
    option.value = fixture.id;
    option.textContent = `${fixture.id} - ${fixture.description}`;
    select.appendChild(option);
  }

  const targetLabel = document.createElement("label");
  targetLabel.textContent = "Decimation target ";
  const targetInput = document.createElement("input");
  targetInput.type = "number";
  targetInput.min = "2";
  targetInput.placeholder = "default";
  targetInput.setAttribute("aria-label", "Decimation target");
  targetLabel.appendChild(targetInput);

  const fontLabel = document.createElement("label");
  const fontInput = document.createElement("input");
  fontInput.type = "checkbox";
  fontInput.checked = false;
  fontInput.setAttribute("aria-label", "Embed font");
  fontLabel.append(fontInput, " Embed font");

  const download = document.createElement("a");
  download.textContent = "Download SVG";

  controls.append(select, targetLabel, fontLabel, download);

  const panes = document.createElement("div");
  panes.style.cssText = "display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-start";
  const canvas = document.createElement("canvas");
  const image = document.createElement("img");
  image.alt = "SVG export";
  panes.append(canvas, image);

  root.append(controls, panes);
  host.container.appendChild(root);

  // Appended after the SVG controls and panes so the existing controls keep their document order.
  const rawDownload = mountRawDownload({ parent: root, signal, getFixture: currentFixture });

  let disposed = false;
  let renderer: Canvas2DRenderer | null = null;
  let objectUrl: string | null = null;

  function currentFixture(): ScenarioFixture {
    const fixture = SCENARIO_FIXTURES.find((f) => f.id === select.value) ?? SCENARIO_FIXTURES[0];
    if (fixture === undefined) throw new Error("the fixture corpus is empty");
    return fixture;
  }

  function exportOptions(): SvgExportOptions {
    const decimationTarget = parseDecimationTarget(targetInput.value);
    return {
      ...(decimationTarget === undefined ? {} : { decimationTarget }),
      ...(fontInput.checked ? { embedFont: TRACEKIT_INTER_EMBEDDED_FONT } : {}),
    };
  }

  function sizeBoth(fixture: ScenarioFixture): void {
    const width = `${fixture.viewport.width}px`;
    const height = `${fixture.viewport.height}px`;
    canvas.style.width = width;
    canvas.style.height = height;
    image.style.width = width;
    image.style.height = height;
  }

  /** The renderer's Y axes are fixed at construction, so a scenario change builds a new one. */
  function renderCanvas(fixture: ScenarioFixture): void {
    renderer?.dispose();
    renderer = new Canvas2DRenderer(
      fixture.yAxes === undefined ? { surface: canvas } : { surface: canvas, yAxes: fixture.yAxes },
    );
    if (fixture.kind === "payload") {
      renderer.setData(fixture.payload);
      renderer.setDomain(fixture.domain.xMin, fixture.domain.xMax, fixture.domain.yMin, fixture.domain.yMax);
    } else {
      renderer.setTraces(fixture.collection);
    }
    renderer.resize(fixture.viewport.width, fixture.viewport.height, fixture.dpr);
    renderer.render();
  }

  function releaseUrl(): void {
    if (objectUrl !== null) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function renderSvg(fixture: ScenarioFixture): void {
    const svg = exportToSvg(sceneFromFixture(fixture), exportOptions());
    releaseUrl();
    objectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    image.src = objectUrl;
    // The download reuses the displayed document's URL: the bytes saved are exactly the bytes shown.
    download.href = objectUrl;
    download.download = `${fixture.id}.svg`;
  }

  function refreshSvg(): void {
    renderSvg(currentFixture());
  }

  function refreshAll(): void {
    const fixture = currentFixture();
    rawDownload.refresh();
    sizeBoth(fixture);
    renderCanvas(fixture);
    renderSvg(fixture);
  }

  select.addEventListener("change", refreshAll, { signal });
  targetInput.addEventListener("input", refreshSvg, { signal });
  fontInput.addEventListener("change", refreshSvg, { signal });

  refreshAll();

  // The face is registered asynchronously; repaint the canvas once it is ready so its labels use
  // the same family the exported text names.
  void ensureDefaultFont().then(() => {
    if (!disposed) renderer?.render();
  });

  return () => {
    disposed = true;
    renderer?.dispose();
    renderer = null;
    releaseUrl();
    rawDownload.dispose();
    root.remove();
  };
}
