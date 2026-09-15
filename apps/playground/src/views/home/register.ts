import { registerView } from "../../shell/registry.js";
import { asRoutePath } from "../../shell/view.js";
import { mount } from "./mount.js";

registerView({ path: asRoutePath("/home"), label: "Home", mount });
