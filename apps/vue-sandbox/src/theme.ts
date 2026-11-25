import { TRACEKIT_INTER_FAMILY, type FigureStyle } from "@trace-kit/renderers";
import { computed, shallowRef, type ComputedRef, type ShallowRef } from "vue";

export type ThemePreference = "system" | "dark" | "light";
export type ResolvedScheme = "dark" | "light";

export const THEME_STORAGE_KEY = "tk-sandbox-scheme";

export const DARK_FIGURE_STYLE: Partial<FigureStyle> = Object.freeze({
  backgroundColor: "#090c10",
  gridColor: "#1b2430",
  axisColor: "#3a4756",
  labelColor: "#8b9bb0",
  traceColor: "#38bdf8",
  lineWidthCss: 1.5,
  font: `11px "${TRACEKIT_INTER_FAMILY}"`,
});

export const LIGHT_FIGURE_STYLE: Partial<FigureStyle> = Object.freeze({
  backgroundColor: "#f8fafc",
  gridColor: "#e2e8f0",
  axisColor: "#94a3b8",
  labelColor: "#475569",
  traceColor: "#0284c7",
  lineWidthCss: 1.5,
  font: `11px "${TRACEKIT_INTER_FAMILY}"`,
});

export function figureStyleForScheme(scheme: ResolvedScheme): Partial<FigureStyle> {
  return scheme === "dark" ? DARK_FIGURE_STYLE : LIGHT_FIGURE_STYLE;
}

function readStoredPreference(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "dark" || raw === "light") {
      return raw;
    }
  } catch {
    // Ignore storage access restrictions (private mode / sandboxed iframe).
  }
  return "system";
}

function applyColorSchemeMeta(preference: ThemePreference): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (meta === null) return;
  meta.content = preference === "system" ? "light dark" : preference;
}

export interface ThemeController {
  readonly preference: Readonly<ShallowRef<ThemePreference>>;
  readonly resolvedScheme: ComputedRef<ResolvedScheme>;
  setPreference(next: ThemePreference): void;
  dispose(): void;
}

/**
 * Manages the 3-state (`system` | `dark` | `light`) color-scheme preference.
 * Syncs `<meta name="color-scheme">`, persists explicit overrides to `localStorage`
 * (removing the key on `"system"`), listens to `matchMedia` without ever retroactively
 * clearing a stored override, and synchronizes across tabs via the `storage` event.
 */
export function createThemeController(): ThemeController {
  const preference = shallowRef<ThemePreference>(readStoredPreference());
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const systemPrefersDark = shallowRef<boolean>(darkQuery.matches);

  applyColorSchemeMeta(preference.value);

  const resolvedScheme = computed<ResolvedScheme>(() => {
    if (preference.value === "dark" || preference.value === "light") {
      return preference.value;
    }
    return systemPrefersDark.value ? "dark" : "light";
  });

  function setPreference(next: ThemePreference): void {
    preference.value = next;
    applyColorSchemeMeta(next);
    try {
      if (next === "system") {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      }
    } catch {
      // Ignore storage write failures.
    }
  }

  const onMediaChange = (event: MediaQueryListEvent): void => {
    // Never clear a user's stored override when OS appearance changes.
    systemPrefersDark.value = event.matches;
  };

  const onStorageChange = (event: StorageEvent): void => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    const synced = readStoredPreference();
    preference.value = synced;
    applyColorSchemeMeta(synced);
  };

  darkQuery.addEventListener("change", onMediaChange);
  window.addEventListener("storage", onStorageChange);

  function dispose(): void {
    darkQuery.removeEventListener("change", onMediaChange);
    window.removeEventListener("storage", onStorageChange);
  }

  return {
    preference,
    resolvedScheme,
    setPreference,
    dispose,
  };
}
