"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";

type Theme = "light" | "dark" | "system";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolved: "light" | "dark";
}>({ theme: "system", setTheme: () => {}, resolved: "light" });

const STORAGE_KEY = "research-os-theme";

function applyTheme(theme: Theme): "light" | "dark" {
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  return resolved;
}

function readTheme(): Theme {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : "system";
}
function themeSnapshot() {
  const theme = readTheme();
  const resolved = theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  return `${theme}:${resolved}`;
}
function subscribeTheme(notify: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const update = () => { applyTheme(readTheme()); notify(); };
  media.addEventListener("change", update);
  window.addEventListener("storage", update);
  window.addEventListener("research-theme", update);
  return () => { media.removeEventListener("change", update); window.removeEventListener("storage", update); window.removeEventListener("research-theme", update); };
}
export function ThemeProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(subscribeTheme, themeSnapshot, () => "system:light");
  const [theme, resolved] = snapshot.split(":") as [Theme, "light" | "dark"];
  useEffect(() => { applyTheme(theme); }, [theme]);
  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    window.dispatchEvent(new Event("research-theme"));
  }, []);
  return <ThemeContext.Provider value={{ theme, setTheme, resolved }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/** Inlined before hydration to avoid a light/dark flash on reload. */
export const ThemeInitScript = `
try {
  var t = localStorage.getItem("${STORAGE_KEY}") || "system";
  var dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
} catch (e) {}
`;
