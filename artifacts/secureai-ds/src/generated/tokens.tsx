/* GENERATED FROM tokens.json -- DO NOT EDIT. Run scripts/build-tokens.mjs. */
// Portable design tokens (colors as hex). Web consumes the theme via
// src/index.css; mobile (Expo) and any other platform import this object so the
// whole product shares one source of truth.
export const tokens = {
  "color": {
    "light": {
      "background": "#f0f5ff",
      "foreground": "#0a1426",
      "border": "#c5d4e8",
      "card": "#ffffff",
      "cardForeground": "#0a1426",
      "popover": "#ffffff",
      "popoverForeground": "#0a1426",
      "primary": "#007a8c",
      "primaryForeground": "#ffffff",
      "secondary": "#e2edf8",
      "secondaryForeground": "#0a1426",
      "muted": "#e2edf8",
      "mutedForeground": "#4a6280",
      "accent": "#007a8c",
      "accentForeground": "#ffffff",
      "destructive": "#dc2626",
      "destructiveForeground": "#ffffff",
      "input": "#c5d4e8",
      "ring": "#007a8c",
      "chart1": "#007a8c",
      "chart2": "#4f46e5",
      "chart3": "#d97706",
      "chart4": "#9333ea",
      "chart5": "#dc2626",
      "sidebar": "#e2edf8",
      "sidebarForeground": "#0a1426",
      "sidebarBorder": "#c5d4e8",
      "sidebarPrimary": "#007a8c",
      "sidebarPrimaryForeground": "#ffffff",
      "sidebarAccent": "#cfdff2",
      "sidebarAccentForeground": "#0a1426",
      "sidebarRing": "#007a8c"
    },
    "dark": {
      "background": "#070c18",
      "foreground": "#dce6f5",
      "border": "#111d2e",
      "card": "#09101e",
      "cardForeground": "#dce6f5",
      "popover": "#09101e",
      "popoverForeground": "#dce6f5",
      "primary": "#04d9ee",
      "primaryForeground": "#070c18",
      "secondary": "#0e1929",
      "secondaryForeground": "#dce6f5",
      "muted": "#0e1929",
      "mutedForeground": "#94aab8",
      "accent": "#04d9ee",
      "accentForeground": "#070c18",
      "destructive": "#f0294a",
      "destructiveForeground": "#f5f9ff",
      "input": "#111d2e",
      "ring": "#04d9ee",
      "chart1": "#04d9ee",
      "chart2": "#667eea",
      "chart3": "#f6a623",
      "chart4": "#b44dff",
      "chart5": "#f0294a",
      "sidebar": "#070c18",
      "sidebarForeground": "#dce6f5",
      "sidebarBorder": "#111d2e",
      "sidebarPrimary": "#04d9ee",
      "sidebarPrimaryForeground": "#070c18",
      "sidebarAccent": "#0e1929",
      "sidebarAccentForeground": "#dce6f5",
      "sidebarRing": "#04d9ee"
    }
  },
  "fontFamily": {
    "sans": [
      "Inter",
      "sans-serif"
    ],
    "serif": [
      "Georgia",
      "serif"
    ],
    "mono": [
      "JetBrains Mono",
      "monospace"
    ]
  },
  "radius": "0rem",
  "spacing": "0.25rem"
} as const;

export type Tokens = typeof tokens;
export default tokens;
