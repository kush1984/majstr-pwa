/**
 * Tiny classnames helper — joins truthy strings with spaces. Avoids
 * pulling in `clsx` for one function.
 */
export function cn(...inputs: Array<string | false | null | undefined>): string {
  return inputs.filter(Boolean).join(' ');
}
