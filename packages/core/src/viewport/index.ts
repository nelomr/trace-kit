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
