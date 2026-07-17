export type ColorMode = "light" | "dark";

export function readColorMode(): ColorMode {
  return document.documentElement.getAttribute("data-color-mode") === "dark" ? "dark" : "light";
}
