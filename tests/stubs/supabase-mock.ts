/**
 * Cliente de Supabase falso para tests de modelos. Modela lo único que
 * importa del contrato real de supabase-js: un query builder ENCADENABLE que
 * al esperarse (`await`) resuelve `{ data, error }` (nunca tira por sí mismo).
 *
 * Cada `from(tabla)` / `rpc(nombre)` consume el próximo resultado encolado
 * para esa clave (el último se repite), y deja registrado qué métodos se
 * encadenaron y con qué argumentos, para poder afirmar sobre la consulta
 * (p. ej. `limit(500)`, `eq('batch_id', ...)`) sin acoplarse al orden interno.
 */

export type MockResult = { data: unknown; error: { code?: string; message: string; details?: string; hint?: string } | null }
export type RecordedCall = { target: string; ops: Array<[method: string, args: unknown[]]> }

export function ok(data: unknown): MockResult {
  return { data, error: null }
}

export function fail(code: string, message: string, extra: { details?: string; hint?: string } = {}): MockResult {
  return { data: null, error: { code, message, ...extra } }
}

function builder(result: MockResult, record: RecordedCall) {
  const proxy: unknown = new Proxy(() => {}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: MockResult) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject)
      }
      return (...args: unknown[]) => {
        record.ops.push([String(prop), args])
        return proxy
      }
    },
  })
  return proxy
}

export function fakeSupabase(config: { from?: Record<string, MockResult[]>; rpc?: Record<string, MockResult[]> }) {
  const calls: RecordedCall[] = []
  const queues = {
    from: Object.fromEntries(Object.entries(config.from ?? {}).map(([k, v]) => [k, [...v]])),
    rpc: Object.fromEntries(Object.entries(config.rpc ?? {}).map(([k, v]) => [k, [...v]])),
  } as { from: Record<string, MockResult[]>; rpc: Record<string, MockResult[]> }

  function next(kind: 'from' | 'rpc', name: string): MockResult {
    const queue = queues[kind][name]
    if (!queue || queue.length === 0) throw new Error(`fakeSupabase: sin resultado encolado para ${kind}('${name}')`)
    return queue.length > 1 ? (queue.shift() as MockResult) : queue[0]
  }

  const client = {
    from(table: string) {
      const record: RecordedCall = { target: `from:${table}`, ops: [] }
      calls.push(record)
      return builder(next('from', table), record)
    },
    rpc(name: string, args?: unknown) {
      const record: RecordedCall = { target: `rpc:${name}`, ops: [['rpc', [args]]] }
      calls.push(record)
      return builder(next('rpc', name), record)
    },
  }

  return {
    client,
    calls,
    /** Llamadas encadenadas de la N-ésima consulta a esa tabla/RPC (default: la primera). */
    opsOf(target: string, index = 0): Array<[string, unknown[]]> {
      return calls.filter((c) => c.target === target)[index]?.ops ?? []
    },
    count(target: string): number {
      return calls.filter((c) => c.target === target).length
    },
  }
}
