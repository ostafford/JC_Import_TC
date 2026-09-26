/**
 * Plain ANSI escapes for `importer setup`'s terminal output — validated live
 * against a prototype (branch `prototype/setup-ux-multi-timeclock`) after
 * the original plain-text flow was found "boring and hard to read". No new
 * dependency (e.g. chalk/picocolors), matching this project's existing
 * zero-dependency CLI style. Auto-disables when stdout isn't a real
 * terminal (piped/redirected), same as any well-behaved CLI.
 */
const useColor = process.stdout.isTTY;
const wrap =
  (code: string) =>
  (s: string): string =>
    useColor ? `\x1b[${code}m${s}\x1b[0m` : s;

export const color = {
  bold: wrap("1"),
  dim: wrap("2"),
  cyan: wrap("36"),
  green: wrap("32"),
  yellow: wrap("33"),
  magenta: wrap("35"),
  red: wrap("31"),
};

export const heading = (s: string): void => console.log(`\n${color.bold(color.cyan(s))}`);
export const success = (s: string): void => console.log(color.green(s));
export const warn = (s: string): void => console.log(color.yellow(s));
export const muted = (s: string): void => console.log(color.dim(s));
