// VitalVR: the "custom" theme, made from two colours the player picks (the
// accent and the background). The shades of each are mixed towards white and
// black, like the built-in themes have them.
type RGB = [number, number, number];

function parse(hex: string): RGB {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(c: RGB, to: number, amount: number): string {
  return c.map((v) => Math.round(v + (to - v) * amount)).join(', ');
}

/** CSS variables of the custom theme. */
export function customThemeVariables(accent: string, background: string) {
  const a = parse(accent);
  const b = parse(background);
  return {
    '--background-10': mix(b, 255, 0.92),
    '--background-20': mix(b, 255, 0.65),
    '--background-30': mix(b, 255, 0.42),
    '--background-40': mix(b, 255, 0.22),
    '--background-50': mix(b, 255, 0.08),
    '--background-60': mix(b, 0, 0),
    '--background-70': mix(b, 0, 0.3),
    '--background-80': mix(b, 0, 0.55),
    '--background-90': mix(b, 0, 0.75),
    '--accent-background-10': mix(a, 255, 0.5),
    '--accent-background-20': mix(a, 0, 0),
    '--accent-background-30': mix(a, 0, 0.4),
    '--accent-background-40': mix(a, 0, 0.55),
    '--accent-background-50': mix(a, 0, 0.75),
    '--window-icon-stroke': mix(a, 255, 0.5),
  };
}

/** Puts the custom theme on the page, or takes it away for the built-in ones. */
export function applyCustomTheme(theme: string, accent: string, background: string) {
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries(
    customThemeVariables(accent, background)
  )) {
    if (theme === 'custom') style.setProperty(name, value);
    else style.removeProperty(name);
  }
}
