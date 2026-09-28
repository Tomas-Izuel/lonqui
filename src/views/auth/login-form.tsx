'use client'

import { useActionState, useEffect, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TextField, PasswordField } from '@/views/shared/form-fields'
import { signIn } from '@/controllers/auth.actions'
import type { ActionResult } from '@/lib/action-result'

const loginSchema = z.object({
  email: z.email('Ingresá un email válido'),
  password: z.string().min(1, 'Ingresá tu contraseña'),
})

type LoginValues = z.infer<typeof loginSchema>

/**
 * Login: `react-hook-form` valida el formato antes de tocar el servidor;
 * `useActionState` maneja el resultado de `signIn` (error genérico —nunca
 * revela si el email existe—, o redirect en éxito, que hace el propio
 * Server Action). `next` viaja en el form para volver a la ruta pedida.
 */
export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, isActionPending] = useActionState<ActionResult | null, FormData>(signIn, null)
  const [isTransitionPending, startTransition] = useTransition()
  const pending = isActionPending || isTransitionPending

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  useEffect(() => {
    if (!state || state.ok) return
    if (state.field === 'email' || state.field === 'password') {
      form.setError(state.field, { message: state.error })
      form.setFocus(state.field)
    }
    // Sin `field`: es el error genérico de credenciales, se muestra arriba del botón.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando cambia el resultado del action
  }, [state])

  function onValid(values: LoginValues) {
    const formData = new FormData()
    formData.set('email', values.email)
    formData.set('password', values.password)
    formData.set('next', next ?? '')
    startTransition(() => formAction(formData))
  }

  const genericError = state && !state.ok && !state.field ? state.error : null

  return (
    // `method="POST"` explícito (CLAUDE.md, hallazgo de log con la
    // contraseña en la URL) y `action={formAction}` para que, sin JS, el
    // navegador mande el POST nativo directo a la Server Action (progressive
    // enhancement de React 19/Next 16): con JS, `onSubmit` gana la carrera
    // (react-hook-form hace `preventDefault` y valida antes de invocar la
    // action a mano, más abajo en `onValid`). En mayúscula, no por estilo:
    // cuando `action` es una función, React SSR IGNORA el `method` que se le
    // pase acá y renderiza el que trae `$$FORM_ACTION` de la referencia a la
    // Server Action, que es literalmente `"POST"` (fuente:
    // `getCustomFormFields`/`react-server-dom-turbopack-client`). El cliente,
    // en cambio, hidrata con el string tal cual está en el JSX — con
    // `"post"` en minúscula quedaba un mismatch de hidratación en cada carga
    // (servidor "POST", cliente "post"); en mayúscula, los dos coinciden.
    <form onSubmit={form.handleSubmit(onValid)} noValidate method="POST" action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next ?? ''} />
      <TextField
        control={form.control}
        name="email"
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="username"
        spellCheck={false}
        autoFocus
        disabled={pending}
      />
      <PasswordField control={form.control} name="password" label="Contraseña" autoComplete="current-password" disabled={pending} />

      {genericError ? (
        <p role="alert" className="text-sm text-destructive">
          {genericError}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="mt-1 h-11 w-full">
        {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
        {pending ? 'Ingresando…' : 'Ingresar'}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        ¿Te olvidaste la contraseña? Pedile una nueva a un administrador del club.
      </p>
    </form>
  )
}
