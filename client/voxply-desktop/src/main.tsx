// main.tsx — Entry point. Mounts the App component into the #root div.
// In Blazor: this is like Program.cs calling builder.Build().RunAsync()

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Find the <div id="root"> in index.html and render our App inside it
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
