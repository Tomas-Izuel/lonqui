import { describe, expect, it } from 'vitest'
import {
  addMonths,
  CLUB_TIME_ZONE,
  formatDate,
  formatDateTime,
  formatPeriod,
  lastDayOfPeriod,
  periodRange,
  previousPeriod,
  toClubDate,
  toPeriod,
} from '@/lib/dates'

/**
 * `toClubDate`/`toPeriod` son el corazón de "zona del club": todo lo que
 * decide un período (cuotas, pagos, eventos de estado) pasa por acá. El caso
 * que importa es el borde del mes en UTC vs. Argentina (UTC-3, sin horario de
 * verano desde 2009): un instante que ya es "1° del mes" en UTC puede seguir
 * siendo el mes anterior en Buenos Aires.
 */
describe('toClubDate', () => {
  it('el 30/09 23:30 hora Argentina (01/10 02:30 UTC) sigue siendo 30/09 en la zona del club', () => {
    // 2026-09-30T23:30 ART = 2026-10-01T02:30Z (ART = UTC-3).
    const instant = new Date('2026-10-01T02:30:00.000Z')
    expect(toClubDate(instant)).toBe('2026-09-30')
  })

  it('a las 00:30 UTC del 1° todavía es el día anterior en Argentina', () => {
    // Este es el caso explícito del enunciado: 00:30 UTC del 1° = 21:30 ART
    // del último día del mes anterior.
    const instant = new Date('2026-10-01T00:30:00.000Z')
    expect(toClubDate(instant)).toBe('2026-09-30')
  })

  it('a las 03:00 UTC del 1° ya es 1° en Argentina (pasó el corte de las 03:00 UTC)', () => {
    const instant = new Date('2026-10-01T03:00:00.000Z')
    expect(toClubDate(instant)).toBe('2026-10-01')
  })
})

describe('toPeriod', () => {
  it('un cron a las 00:05 UTC del 1° calcula el período del mes anterior, no el nuevo', () => {
    // Este es literalmente el horario en que pg_cron dispara la generación de
    // cuotas ('5 3 1 * *' UTC, ver 00-architecture.md §6.2): a esa hora en
    // Argentina todavía no es el 1°.
    const cronFireTimeUtc = new Date('2026-10-01T00:05:00.000Z')
    expect(toPeriod(cronFireTimeUtc)).toBe('2026-09-01')
  })

  it('2026-09-30T23:30 ART (2026-10-01T02:30Z) da el período de septiembre, no octubre', () => {
    const instant = new Date('2026-10-01T02:30:00.000Z')
    expect(toPeriod(instant)).toBe('2026-09-01')
  })

  it('bien entrada la noche del 1° en Argentina, el período ya es el nuevo mes', () => {
    const instant = new Date('2026-10-01T12:00:00.000Z') // 09:00 ART del 1°
    expect(toPeriod(instant)).toBe('2026-10-01')
  })

  it('siempre devuelve el primer día del mes, sin importar el día del instante', () => {
    const instant = new Date('2026-09-15T18:00:00.000Z')
    expect(toPeriod(instant)).toBe('2026-09-01')
  })
})

describe('formatPeriod', () => {
  it('"2026-09-01" se lee "septiembre 2026", sin la partícula "de"', () => {
    expect(formatPeriod('2026-09-01')).toBe('septiembre 2026')
  })

  it('no se corre de mes por el borde de zona horaria (usa mediodía UTC)', () => {
    // Enero es el caso que rompería si se usara medianoche UTC en una zona
    // con offset negativo mal manejado.
    expect(formatPeriod('2026-01-01')).toBe('enero 2026')
    expect(formatPeriod('2026-12-01')).toBe('diciembre 2026')
  })
})

describe('formatDate', () => {
  it('"2026-09-25" se muestra "25/09/2026", sin pasar por Date', () => {
    expect(formatDate('2026-09-25')).toBe('25/09/2026')
  })

  it('acepta un timestamptz completo y solo usa la parte de fecha', () => {
    expect(formatDate('2026-09-25T23:59:59.999999+00:00')).toBe('25/09/2026')
  })
})

describe('formatDateTime', () => {
  it('muestra hora 24h sin ambigüedad (nunca "24:00")', () => {
    // Medianoche en la zona del club.
    const midnightArt = new Date('2026-09-26T03:00:00.000Z') // 00:00 ART
    const formatted = formatDateTime(midnightArt)
    expect(formatted).not.toContain('24:')
    expect(formatted.startsWith('26/09/2026')).toBe(true)
  })

  it('acepta un string ISO igual que un Date', () => {
    const asString = formatDateTime('2026-09-25T14:30:00.000Z')
    const asDate = formatDateTime(new Date('2026-09-25T14:30:00.000Z'))
    expect(asString).toBe(asDate)
  })
})

it('la zona del club es Argentina, no la del proceso', () => {
  expect(CLUB_TIME_ZONE).toBe('America/Argentina/Buenos_Aires')
})

/**
 * `addMonths`/`previousPeriod`/`lastDayOfPeriod`/`periodRange` (slice 2,
 * `S4`): aritmética de enteros sobre `YYYY-MM-01`, sin pasar por `Date` en
 * casi ningún lado — la generación mensual y `private.generate_pending_fees`
 * recorren períodos con esta misma lógica del lado de Postgres.
 */
describe('addMonths', () => {
  it('suma meses dentro del mismo año', () => {
    expect(addMonths('2026-09-01', 2)).toBe('2026-11-01')
  })

  it('cruza de diciembre a enero (suma)', () => {
    expect(addMonths('2026-11-01', 2)).toBe('2027-01-01')
  })

  it('acepta negativos, incluido cruzar de enero a diciembre del año anterior', () => {
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01')
  })

  it('con 0 devuelve el mismo período', () => {
    expect(addMonths('2026-09-01', 0)).toBe('2026-09-01')
  })
})

describe('previousPeriod', () => {
  it('es addMonths(-1)', () => {
    expect(previousPeriod('2026-09-01')).toBe('2026-08-01')
  })

  it('cruza de enero al diciembre anterior', () => {
    expect(previousPeriod('2026-01-01')).toBe('2025-12-01')
  })
})

describe('lastDayOfPeriod', () => {
  it('un mes de 28 días (febrero no bisiesto)', () => {
    expect(lastDayOfPeriod('2026-02-01')).toBe('2026-02-28')
  })

  it('un año bisiesto: febrero tiene 29', () => {
    expect(lastDayOfPeriod('2028-02-01')).toBe('2028-02-29')
  })

  it('un mes de 30 días', () => {
    expect(lastDayOfPeriod('2026-09-01')).toBe('2026-09-30')
  })

  it('un mes de 31 días', () => {
    expect(lastDayOfPeriod('2026-01-01')).toBe('2026-01-31')
  })
})

describe('periodRange', () => {
  it('devuelve todos los períodos entre from y to, inclusive, en orden', () => {
    expect(periodRange('2026-07-01', '2026-09-01')).toEqual(['2026-07-01', '2026-08-01', '2026-09-01'])
  })

  it('from === to: un solo período', () => {
    expect(periodRange('2026-09-01', '2026-09-01')).toEqual(['2026-09-01'])
  })

  it('from > to: vacío (nunca un rango descendente ni un loop infinito)', () => {
    expect(periodRange('2026-09-01', '2026-07-01')).toEqual([])
  })
})
