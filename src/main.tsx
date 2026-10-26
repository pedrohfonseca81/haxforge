import "@fontsource-variable/inter";
import "./styles.css";
import { render } from "preact";
import { App } from "./ui/App";

import { listFonts } from "./persist/db";
import { loadSavedFonts } from "./smart/fonts";
import { startAgents } from "./agent/webmcp";

void loadSavedFonts(listFonts);
startAgents();
render(<App />, document.getElementById("app")!);
