// Mirrors the web app's design tokens (artifacts/secureai/src/index.css) so
// the mobile UI reads as the same product, not a different app that happens
// to share a backend. Colors are HSL->RGB conversions of the web CSS
// variables (--background, --primary, etc. under :root); font-mono maps to
// RN's built-in "monospace" family since embedding the web's actual
// JetBrains Mono font would require a new native asset-loading dependency.
export const colors = {
  background: '#05080F',
  card: '#080C17',
  border: '#10192D',
  foreground: '#E1E7EF',
  mutedForeground: '#94A3B8',
  primary: '#06DCF0',
  primaryForeground: '#03050A',
  destructive: '#F43E5D',
  success: '#4ADE80',
  warning: '#FACC15',
  info: '#60A5FA',
};

export const fonts = {
  mono: 'monospace',
};
