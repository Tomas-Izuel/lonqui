import { exportOtherIncomeCsv } from '@/controllers/income.controller'
import { toApiError } from '@/lib/errors'

// Lee la sesión (cookies) y audita cada descarga: nunca se cachea ni se prerenderiza.
export const dynamic = 'force-dynamic'

/** `GET /api/caja/ingresos/exportar?mes=YYYY-MM&concepto=&sponsor=` → CSV de otros ingresos. */
export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url)
    const { filename, body } = await exportOtherIncomeCsv(Object.fromEntries(searchParams))

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const { body, status } = toApiError(err, 'income.export')
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
  }
}
