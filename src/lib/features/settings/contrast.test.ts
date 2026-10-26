import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const css = readFileSync('src/lib/features/settings/theme.css', 'utf8');
function palette(selector: string) {
  const body = css.slice(css.indexOf(selector)).match(/\{([^}]+)\}/)![1];
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*(#[\da-f]{6});/g)].map((match) => [match[1], match[2]]),
  );
}
function luminance(hex: string) {
  const values = [1, 3, 5]
    .map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
it('all shared text roles meet WCAG AA 4.5:1 on every light and dark surface; focus meets 3:1', () => {
  const light = palette(':root {');
  const dark = { ...light, ...palette(":root[data-theme='dark'] {") };
  for (const [theme, colors] of Object.entries({ light, dark })) {
    for (const surface of ['background', 'surface', 'muted']) {
      for (const text of ['foreground', 'muted-foreground', 'destructive', 'warning', 'success'])
        expect(
          contrast(colors[text], colors[surface]),
          `${theme}: ${text} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(colors.ring, colors[surface]),
        `${theme}: focus on ${surface}`,
      ).toBeGreaterThanOrEqual(3);
    }
    expect(
      contrast(colors['on-primary'], colors.primary),
      `${theme}: primary text`,
    ).toBeGreaterThanOrEqual(4.5);
  }
});
it('the shell stylesheet has no remaining literal colors and uses logical layout edges', () => {
  const shell = readFileSync('src/app.css', 'utf8');
  expect(shell).not.toMatch(/#[\da-f]{3,8}\b/i);
  expect(shell).not.toMatch(
    /(?:margin|padding|border)-(?:left|right)|text-align:\s*(?:left|right)/,
  );
  const roles = [...shell.matchAll(/(?:^|[;{])\s*color:\s*([^;]+)/g)].map((match) =>
    match[1].trim(),
  );
  for (const role of roles)
    expect([
      'inherit',
      'var(--foreground)',
      'var(--muted-foreground)',
      'var(--destructive)',
      'var(--warning)',
      'var(--on-primary)',
    ]).toContain(role);
});
