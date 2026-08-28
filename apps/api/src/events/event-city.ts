/**
 * The stable city key used by event write and discovery flows.
 * It intentionally keeps the database value ASCII so UI labels and typed
 * Turkish variants (İstanbul/Istanbul, Eskişehir/Eskisehir) resolve together.
 */
export function canonicalEventCity(value: string): string {
  const ascii = value.trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ı/g, 'i')
    .toLocaleLowerCase('en-US');
  return ascii.replace(/(^|[\s-])(\p{L})/gu, (_match, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
}
