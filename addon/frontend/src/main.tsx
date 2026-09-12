import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { launchFinishQueue } from "./api";
import { App } from "./App";
import "./index.css";
import { PrototypeSwitcher } from "./ui/PagePrototype";

const container = document.getElementById("root");
if (!container) {
  throw new Error("No #root element to mount into");
}

// Once per page load, outside React: StrictMode would otherwise start two
// queues, each with its own retry timer.
const { queue, flushed } = launchFinishQueue();

createRoot(container).render(
  <StrictMode>
    <App queue={queue} flushed={flushed} />
    <PrototypeSwitcher />
  </StrictMode>,
);
