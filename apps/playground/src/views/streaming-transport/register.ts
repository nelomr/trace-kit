import { registerView } from "../../shell/registry.js";
import { asRoutePath } from "../../shell/view.js";
import { mount } from "./mount.js";

registerView({
  path: asRoutePath("/streaming-transport"),
  label: "Streaming Transport",
  mount,
});
