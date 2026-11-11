import { createRoot } from "react-dom/client";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/500-italic.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";

// No StrictMode: its double mount would build the full-resolution brain twice in development.
const root = createRoot(document.getElementById("root")!);
if (new URLSearchParams(location.search).has("cameo-lab")) {
  void import("./portrait/Lab").then(({ Lab }) => root.render(<Lab />));
} else {
  void import("./App").then(({ App }) => root.render(<App />));
}
