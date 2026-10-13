/**
 * CSV puro y sin dependencias. Default pensado para Excel en español
 * (Argentina): separador `;` (la coma es el separador decimal) y BOM UTF-8
 * para que abra bien los acentos. Filas separadas por CRLF.
 */
export type CsvCell = string | number | null

export function toCsv(
  rows: readonly (readonly CsvCell[])[],
  options: { separator?: ';' | ','; bom?: boolean } = {},
): string {
  const { separator = ';', bom = true } = options
  const quote = (cell: CsvCell): string => {
    if (cell === null) return ''
    const text = typeof cell === 'number' ? String(cell) : cell
    return text.includes(separator) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const body = rows.map((row) => row.map(quote).join(separator)).join('\r\n')
  return (bom ? '\uFEFF' : '') + body
}
