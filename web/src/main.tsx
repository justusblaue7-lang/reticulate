import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import { boot } from "./api";
import { App } from "./App";
import "./styles.css";

// No StrictMode: its double mount would build the full-resolution brain twice in development.
const root = createRoot(document.getElementById("root")!);
if (new URLSearchParams(location.search).has("people-bake")) {
  void import("./people/Bake").then(({ Bake }) => root.render(<Bake />));
} else {
  void boot(); // the first data is on its way while React starts
  root.render(<App />);
}
