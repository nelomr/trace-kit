import { registerView } from "../../shell/registry.js";
import { asRoutePath } from "../../shell/view.js";
import { mount } from "./mount.js";

registerView({
  path: asRoutePath("/engine-controller"),
  label: "Engine Controller",
  mount,
});
