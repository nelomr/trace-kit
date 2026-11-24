/** Internal barrel for the viewport module. Not the public export surface — see `src/index.ts`. */
export {
  createViewportTransform,
  projectX,
  projectY,
  unprojectX,
  unprojectY,
  isInsidePlotArea,
  transformMatchesPayload,
  Y_SCALE_KIND_LINEAR,
  Y_SCALE_KIND_LOG,
  type ViewportTransform,
  type CreateViewportTransformOptions,
} from "./transform.js";
export { selectTicks, selectLogTicks } from "./ticks.js";
export {
  createAxisTransforms,
  AXIS_SIDE_LEFT,
  type YAxisRegistration,
  type SharedViewportOptions,
} from "./axes.js";
export {
  createSampleSpan,
  resolveSampleWindow,
  type SampleSpan,
  type SampleWindowOptions,
} from "./window.js";
export {
  AXIS_MASK_NONE,
  AXIS_MASK_X,
  AXIS_MASK_Y,
  AXIS_MASK_XY,
  ULP_MIN_SPAN_FACTOR,
  LOG_EXPONENT_MIN,
  LOG_EXPONENT_MAX,
  DEFAULT_MIN_LOG_DECADES_Y,
  createMutableViewportDomain,
  createPanGestureSnapshot,
  capturePanGestureSnapshot,
  computeUlpMinSpan,
  clampViewportDomain,
  computeZoomDomain,
  computePanDomain,
  computeBoxZoomDomain,
  type AxisMask,
  type MutableViewportDomain,
  type ViewportDomainBounds,
  type ViewportDomainConstraints,
  type PanGestureSnapshot,
} from "./interaction.js";
