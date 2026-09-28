'use client'

import Link from 'next/link'
import { useActionState, useEffect, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PasswordField } from '@/views/shared/form-fields'
import { passwordPolicySchema } from '@/lib/passwords'
import { changePassword, signOut } from '@/controllers/auth.actions'
import type { ActionResult } from '@/lib/action-result'
import { cn } from '@/lib/utils'

const POLICY_TEXT = 'Al menos 10 caracteres, con letras y números.'

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Ingresá tu contraseña actual'),
    newPassword: passwordPolicySchema,
    confirmPassword: z.string().min(1, 'Repetí la contraseña nueva'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: 'Elegí una contraseña distinta a la actual',
    path: ['newPassword'],
  })

type FormValues = z.infer<typeof schema>

type FormField = 'currentPassword' | 'newPassword' | 'confirmPassword'

function isFormField(field: string | undefined): field is FormField {
  return field === 'currentPassword' || field === 'newPassword' || field === 'confirmPassword'
}

/**
 * Cambio de contraseña: obligatorio (contraseña temporal recién asignada;
 * sin navegación, sin "volver", ni siquiera vía `next` — el único otro
 * control es "Cerrar sesión" como link discreto al pie, porque el celular de
 * la sede lo comparte más de una persona y quien entra después tiene que
 * volver a caer acá) o voluntario (desde el menú del usuario, con un link
 * para cancelar y volver a `next`). El texto de la política se dice ANTES de
 * fallar, no después.
 */
export function ChangePasswordForm({ mode, next }: { mode: 'mandatory' | 'voluntary'; next?: string }) {
  // Refuerzo (2026-09-25): en modo obligatorio `next` no se usa aunque algo
  // lo pase por error — no hay "hacia afuera" desde acá.
  const effectiveNext = mode === 'mandatory' ? undefined : next

  const [state, formAction, isActionPending] = useActionState<ActionResult | null, FormData>(changePassword, null)
  const [isTransitionPending, startTransition] = useTransition()
  const [signOutPending, startSignOutTransition] = useTransition()
  const pending = isActionPending || isTransitionPending

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  useEffect(() => {
    if (!state || state.ok) return
    if (isFormField(state.field)) {
      form.setError(state.field, { message: state.error })
      form.setFocus(state.field)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando cambia el resultado del action
  }, [state])

  function onValid(values: FormValues) {
    const formData = new FormData()
    formData.set('currentPassword', values.currentPassword)
    formData.set('newPassword', values.newPassword)
    formData.set('confirmPassword', values.confirmPassword)
    formData.set('next', effectiveNext ?? '')
    startTransition(() => formAction(formData))
  }

  const genericError = state && !state.ok && !isFormField(state.field) ? state.error : null

  return (
    <div className="flex flex-col gap-6">
      {mode === 'mandatory' ? (
        <p className="text-sm text-muted-foreground">Te asignaron una contraseña temporal. Elegí una tuya para seguir.</p>
      ) : null}

      {/* `method="POST"` + `action={formAction}`: mismo patrón que `LoginForm`,
          progressive enhancement sin JS. `next` viaja también como input
          oculto para que la sumisión nativa (sin JS) lo conserve. En
          mayúscula por lo mismo que en `LoginForm`: con `action` de función,
          el SSR de React fuerza `method="POST"` (viene de `$$FORM_ACTION` de
          la Server Action) sin importar lo que se le pase acá, y el cliente
          hidrata con el string literal del JSX — en minúscula, mismatch de
          hidratación en cada carga. */}
      <form onSubmit={form.handleSubmit(onValid)} noValidate method="POST" action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={effectiveNext ?? ''} />
        <PasswordField
          control={form.control}
          name="currentPassword"
          label={mode === 'mandatory' ? 'Contraseña temporal' : 'Contraseña actual'}
          autoComplete="current-password"
          autoFocus
          disabled={pending}
        />
        <PasswordField
          control={form.control}
          name="newPassword"
          label="Contraseña nueva"
          description={POLICY_TEXT}
          autoComplete="new-password"
          disabled={pending}
        />
        <PasswordField
          control={form.control}
          name="confirmPassword"
          label="Repetir contraseña nueva"
          autoComplete="new-password"
          disabled={pending}
        />

        {genericError ? (
          <p role="alert" className="text-sm text-destructive">
            {genericError}
          </p>
        ) : null}

        <Button type="submit" disabled={pending} className="mt-1 h-11 w-full">
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {pending ? 'Guardando…' : 'Guardar contraseña'}
        </Button>

        {mode === 'voluntary' ? (
          <Button asChild variant="ghost" className="h-11 w-full" disabled={pending}>
            <Link href={effectiveNext ?? '/'}>Cancelar</Link>
          </Button>
        ) : null}
      </form>

      {mode === 'mandatory' ? (
        <button
          type="button"
          disabled={signOutPending}
          onClick={() => startSignOutTransition(() => signOut())}
          className={cn(
            'inline-flex min-h-11 items-center self-center px-2 text-sm text-muted-foreground underline-offset-4',
            'hover:text-foreground hover:underline disabled:opacity-50',
          )}
        >
          {signOutPending ? 'Saliendo…' : 'Cerrar sesión'}
        </button>
      ) : null}
    </div>
  )
}
