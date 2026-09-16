/** Internal barrel for the viewport module. Not the public export surface — see `src/index.ts`. */
export {
  createViewportTransform,
  projectX,
  projectY,
  unprojectX,
  unprojectY,
  isInsidePlotArea,
  transformMatchesPayload,
  type ViewportTransform,
  type CreateViewportTransformOptions,
} from "./transform.js";
export { selectTicks } from "./ticks.js";
