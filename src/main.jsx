import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./css/theme.css";
import "./css/components.css";

if (localStorage.getItem("nodonote:darkMode") === "true") {
  document.documentElement.classList.add("dark");
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
