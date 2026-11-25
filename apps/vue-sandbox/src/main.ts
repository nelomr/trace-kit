import "./styles.css";
import { createApp } from "vue";
import { App } from "./App.ts";

const mountPoint = document.getElementById("app");
if (mountPoint === null) {
  throw new Error('index.html is missing its "#app" mount element.');
}

createApp(App).mount(mountPoint);
