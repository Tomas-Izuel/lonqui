# 02 — Desarrollo SH2 (views/shared) y SH3 (lib/csv)

Hecho: SH2 y SH3. Typecheck y eslint verdes sobre `src/views/shared` y `src/lib/csv.ts`.

- `overlay-params.ts`: `OverlayName = 'pagar' | 'ver' | 'ingreso'`; `OVERLAY_NAMES` con los tres (abrir uno quita los otros). Re-exporta `parseIncomeOverlay`, `incomeOverlayValue`, `IncomeOverlayTarget`.
- `overlay-values.ts`: `IncomeOverlayTarget = { mode: 'nuevo'; sponsorId?: number }`, `parseIncomeOverlay(value: string | null)`, `incomeOverlayValue(target): string`. `'nuevo'`, `'sponsor:<id>'` (entero > 0); `sponsor:0`, `socio:1`, basura -> null.
- `success-moment.tsx`: `SuccessMoment({ amountCents, label })`, copia fiel de `PaymentSuccessMoment` (el original no se tocó).
- `reason-dialog.tsx`: `showDate?: boolean` (default true). Con false no renderiza ni valida la fecha (schema `reasonOnlySchema`). Decisión: `ReasonDialogValues.effectiveOn` sigue siendo `string` (no se volvió opcional, para no romper a los llamadores actuales); con `showDate=false` llega `defaultEffectiveOn` u hoy (Buenos Aires) y el llamador lo ignora.
- `hero-figure.tsx`: solo el comentario (excepción `/caja`).
- `src/lib/csv.ts`: `toCsv(rows, { separator?: ';' | ','; bom?: boolean })`, default `;` + BOM, CRLF, citado de separador/comillas/CR/LF, null -> vacío. Exporta también `CsvCell`.

Sin tests (los escribe test-engineer). Ejemplo esperado: `['a;b','c"d',null,10000]` -> `"a;b";"c""d";;10000`.
