'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useWatch, type Path } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel } from '@/views/shared/panel'
import {
  CheckboxField,
  DateField,
  DniField,
  PhoneField,
  SelectField,
  TextField,
  TextareaField,
} from '@/views/shared/form-fields'
import { DateText } from '@/views/shared/date-text'
import { memberStatusLabels } from '@/views/shared/labels'
import { toClubDate } from '@/lib/dates'
import { createFamilyGroup, createMember, updateMember } from '@/controllers/members.actions'
import type { DisciplineWithCategories, FamilyGroupSummary, MemberDetail } from '@/models/types'

const NO_GROUP = '__none__'
const NEW_GROUP = '__new__'

/**
 * Shape del formulario en el cliente. Selects van como `string` (Radix
 * `Select` no maneja números) y se convierten a `number | undefined` recién
 * al armar el payload para la Server Action — el schema real (`members.model.ts`,
 * B2) vive en el servidor; esto es validación de formato para no ir y volver
 * por cada error obvio.
 */
const baseShape = {
  firstName: z.string().trim().min(1, 'El nombre es obligatorio'),
  lastName: z.string().trim().min(1, 'El apellido es obligatorio'),
  dni: z.string().trim(),
  dniPending: z.boolean(),
  birthDate: z.string(),
  address: z.string(),
  phone: z.string(),
  email: z.string(),
  memberType: z.enum(['practicing', 'non_practicing']),
  disciplineId: z.string(),
  categoryId: z.string(),
  familyGroupChoice: z.string(),
  newGroupName: z.string(),
  newGroupPayerContactName: z.string(),
  newGroupPayerContactPhone: z.string(),
  notes: z.string(),
}

type BaseData = {
  dni: string
  dniPending: boolean
  birthDate: string
  email: string
  memberType: string
  categoryId: string
}

function sharedRefine(data: BaseData, ctx: z.RefinementCtx) {
  if (!data.dniPending) {
    if (!data.dni) {
      ctx.addIssue({
        code: 'custom',
        message: 'El DNI es obligatorio. Si todavía no lo tenés, marcá "DNI pendiente"',
        path: ['dni'],
      })
    } else if (!/^\d{7,8}$/.test(data.dni)) {
      ctx.addIssue({ code: 'custom', message: 'El DNI tiene que tener 7 u 8 dígitos', path: ['dni'] })
    }
  } else if (data.dni) {
    ctx.addIssue({ code: 'custom', message: 'No podés cargar un DNI y marcarlo pendiente al mismo tiempo', path: ['dni'] })
  }

  if (data.birthDate && data.birthDate > toClubDate()) {
    ctx.addIssue({ code: 'custom', message: 'La fecha de nacimiento no puede ser futura', path: ['birthDate'] })
  }

  if (data.email && !z.email().safeParse(data.email).success) {
    ctx.addIssue({ code: 'custom', message: 'El email no es válido', path: ['email'] })
  }

  if (data.memberType === 'practicing' && !data.categoryId) {
    ctx.addIssue({ code: 'custom', message: 'Un socio practicante necesita una categoría', path: ['categoryId'] })
  }
}

/** `joinedOn` vive en el mismo schema en los dos modos (evita dos tipos de formulario distintos); solo se exige/valida en `create`. */
function buildSchema(mode: 'create' | 'edit') {
  return z
    .object({ ...baseShape, joinedOn: z.string() })
    .superRefine((data, ctx) => {
      sharedRefine(data, ctx)
      if (mode === 'create') {
        if (!data.joinedOn) {
          ctx.addIssue({ code: 'custom', message: 'Elegí una fecha', path: ['joinedOn'] })
        } else if (data.joinedOn > toClubDate()) {
          ctx.addIssue({ code: 'custom', message: 'La fecha de alta no puede ser futura', path: ['joinedOn'] })
        }
      }
    })
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>

const KNOWN_FIELDS = [
  'firstName',
  'lastName',
  'dni',
  'dniPending',
  'birthDate',
  'address',
  'phone',
  'email',
  'memberType',
  'categoryId',
  'joinedOn',
  'notes',
] as const

function isKnownField(field: string | undefined): field is Path<FormValues> {
  return (KNOWN_FIELDS as readonly string[]).includes(field ?? '')
}

export type MemberFormProps =
  | { mode: 'create'; member?: undefined; disciplines: DisciplineWithCategories[]; familyGroups: FamilyGroupSummary[] }
  | { mode: 'edit'; member: MemberDetail; disciplines: DisciplineWithCategories[]; familyGroups: FamilyGroupSummary[] }

/**
 * Ficha de ingreso y edición (route-socios-nuevo.md): el mismo formulario en
 * los dos modos, sin `joinedOn` ni `status` editables en edición. Una sola
 * columna, secciones cortas como `Panel` hermanos (nunca anidados).
 */
export function MemberForm({ mode, member, disciplines, familyGroups }: MemberFormProps) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const defaultFamilyChoice = member?.familyGroupId != null ? String(member.familyGroupId) : NO_GROUP

  const form = useForm<FormValues>({
    resolver: zodResolver(buildSchema(mode)),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      firstName: member?.firstName ?? '',
      lastName: member?.lastName ?? '',
      dni: member?.dni ?? '',
      dniPending: member ? member.dni == null : false,
      birthDate: member?.birthDate ?? '',
      address: member?.address ?? '',
      phone: member?.phone ?? '',
      email: member?.email ?? '',
      memberType: member?.memberType ?? 'practicing',
      disciplineId: member?.disciplineId != null ? String(member.disciplineId) : '',
      categoryId: member?.categoryId != null ? String(member.categoryId) : '',
      familyGroupChoice: defaultFamilyChoice,
      newGroupName: '',
      newGroupPayerContactName: '',
      newGroupPayerContactPhone: '',
      notes: member?.notes ?? '',
      joinedOn: mode === 'create' ? toClubDate() : '',
    },
  })

  const memberType = useWatch({ control: form.control, name: 'memberType' })
  const dniPending = useWatch({ control: form.control, name: 'dniPending' })
  const disciplineId = useWatch({ control: form.control, name: 'disciplineId' })
  const familyGroupChoice = useWatch({ control: form.control, name: 'familyGroupChoice' })

  // No practicante: no tiene disciplina ni categoría.
  useEffect(() => {
    if (memberType === 'non_practicing') {
      form.setValue('disciplineId', '')
      form.setValue('categoryId', '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando cambia el tipo de socio
  }, [memberType])

  // DNI pendiente: se limpia el DNI cargado (son mutuamente excluyentes, igual que en el servidor).
  useEffect(() => {
    if (dniPending) form.setValue('dni', '')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando cambia el check
  }, [dniPending])

  // Cambiar de disciplina limpia la categoría (pertenece a la anterior) — pero no en el primer
  // render, donde `disciplineId` llega precargado en edición y no hay que perder `categoryId`.
  // Ojo: un flag booleano "ya renderizó una vez" NO alcanza acá — el modo Strict de React
  // invoca los effects dos veces al montar en desarrollo, y la segunda invocación encontraría
  // el flag ya en `false` y limpiaría igual. Comparar contra el valor anterior guardado en un
  // ref (inicializado con el valor actual, no con un booleano) es idempotente ante esa segunda
  // invocación: la comparación da igual las veces que se repita.
  const previousDisciplineId = useRef(disciplineId)
  useEffect(() => {
    if (previousDisciplineId.current !== disciplineId) {
      form.setValue('categoryId', '')
      previousDisciplineId.current = disciplineId
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando cambia la disciplina
  }, [disciplineId])

  const disciplineOptions = disciplines.map((d) => ({ value: String(d.id), label: d.name }))
  const categoryOptions = (disciplines.find((d) => String(d.id) === disciplineId)?.categories ?? []).map((c) => ({
    value: String(c.id),
    label: c.name,
  }))
  const familyGroupOptions = [
    { value: NO_GROUP, label: 'Sin grupo' },
    ...familyGroups.map((g) => ({ value: String(g.id), label: g.label })),
    { value: NEW_GROUP, label: 'Crear un grupo nuevo' },
  ]

  async function onValid(values: FormValues) {
    setServerError(null)

    let familyGroupId: number | undefined
    if (values.familyGroupChoice === NEW_GROUP) {
      const groupResult = await createFamilyGroup({
        name: values.newGroupName.trim() || undefined,
        payerContactName: values.newGroupPayerContactName.trim() || undefined,
        payerContactPhone: values.newGroupPayerContactPhone.trim() || undefined,
      })
      if (!groupResult.ok) {
        setServerError(groupResult.error)
        return
      }
      familyGroupId = groupResult.data.id
    } else if (values.familyGroupChoice !== NO_GROUP) {
      familyGroupId = Number(values.familyGroupChoice)
    }

    const shared = {
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      dni: values.dniPending ? undefined : values.dni.trim() || undefined,
      dniPending: values.dniPending || undefined,
      birthDate: values.birthDate || undefined,
      address: values.address.trim() || undefined,
      phone: values.phone.trim() || undefined,
      email: values.email.trim() || undefined,
      memberType: values.memberType,
      categoryId: values.memberType === 'practicing' && values.categoryId ? Number(values.categoryId) : undefined,
      familyGroupId,
      notes: values.notes.trim() || undefined,
    }

    if (mode === 'create') {
      const result = await createMember({ ...shared, joinedOn: values.joinedOn })
      if (!result.ok) {
        if (isKnownField(result.field)) {
          form.setError(result.field, { message: result.error })
          form.setFocus(result.field)
        } else {
          setServerError(result.error)
        }
        return
      }
      toast.success('Ficha creada')
      router.push(`/socios/${result.data.id}`)
      return
    }

    const result = await updateMember(member!.id, shared)
    if (!result.ok) {
      if (isKnownField(result.field)) {
        form.setError(result.field, { message: result.error })
        form.setFocus(result.field)
      } else {
        setServerError(result.error)
      }
      return
    }
    toast.success('Cambios guardados')
    router.push(`/socios/${member!.id}`)
  }

  const pending = form.formState.isSubmitting

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <h1 className="font-heading text-xl font-semibold text-balance sm:text-2xl">
        {mode === 'create' ? 'Ficha de ingreso' : `Editar a ${member!.fullName}`}
      </h1>

      {mode === 'edit' ? (
        <p className="text-sm text-muted-foreground">
          Alta: <DateText date={member!.joinedOn} /> · Estado: {memberStatusLabels[member!.status]}
        </p>
      ) : null}

      <form onSubmit={form.handleSubmit(onValid)} noValidate className="flex flex-col gap-4">
        <Panel title="Datos personales">
          <div className="flex flex-col gap-4">
            <TextField control={form.control} name="firstName" label="Nombre" autoFocus disabled={pending} />
            <TextField control={form.control} name="lastName" label="Apellido" disabled={pending} />
            <DniField control={form.control} name="dni" disabled={pending || dniPending} />
            <CheckboxField control={form.control} name="dniPending" label="Todavía no tengo el DNI" disabled={pending} />
            <DateField control={form.control} name="birthDate" label="Fecha de nacimiento" max={toClubDate()} disabled={pending} />
            <TextField control={form.control} name="address" label="Domicilio" disabled={pending} />
            <PhoneField control={form.control} name="phone" label="Teléfono" disabled={pending} />
            <TextField
              control={form.control}
              name="email"
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              spellCheck={false}
              disabled={pending}
            />
          </div>
        </Panel>

        <Panel title="Tipo de socio">
          <div className="flex flex-col gap-4">
            <SelectField
              control={form.control}
              name="memberType"
              label="Tipo"
              disabled={pending}
              options={[
                { value: 'practicing', label: 'Practicante' },
                { value: 'non_practicing', label: 'No practicante' },
              ]}
            />
            {memberType === 'practicing' ? (
              <>
                <SelectField
                  control={form.control}
                  name="disciplineId"
                  label="Disciplina"
                  disabled={pending}
                  placeholder="Elegí una disciplina"
                  options={disciplineOptions}
                />
                <SelectField
                  control={form.control}
                  name="categoryId"
                  label="Categoría"
                  disabled={pending || !disciplineId}
                  placeholder={disciplineId ? 'Elegí una categoría' : 'Elegí primero la disciplina'}
                  options={categoryOptions}
                />
              </>
            ) : null}
          </div>
        </Panel>

        <Panel title="Grupo familiar">
          <div className="flex flex-col gap-4">
            <SelectField
              control={form.control}
              name="familyGroupChoice"
              label="Grupo familiar"
              disabled={pending}
              options={familyGroupOptions}
            />
            {familyGroupChoice === NEW_GROUP ? (
              <div className="flex flex-col gap-4 rounded-lg border border-border p-3">
                <TextField control={form.control} name="newGroupName" label="Nombre del grupo (opcional)" disabled={pending} />
                <TextField
                  control={form.control}
                  name="newGroupPayerContactName"
                  label="Contacto de pago (opcional)"
                  description="Para cuando quien paga no es socio (ej. un padre o una madre)."
                  disabled={pending}
                />
                <PhoneField
                  control={form.control}
                  name="newGroupPayerContactPhone"
                  label="Teléfono del contacto (opcional)"
                  disabled={pending}
                />
              </div>
            ) : null}
          </div>
        </Panel>

        {mode === 'create' ? (
          <Panel title="Fecha de alta">
            <DateField control={form.control} name="joinedOn" label="Fecha de alta" max={toClubDate()} disabled={pending} />
          </Panel>
        ) : null}

        <Panel title="Notas">
          <TextareaField control={form.control} name="notes" label="Notas internas (opcional)" disabled={pending} />
        </Panel>

        {serverError ? (
          <p role="alert" className="text-sm text-destructive">
            {serverError}
          </p>
        ) : null}

        <Button type="submit" disabled={pending} className="h-11 w-full">
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {pending ? 'Guardando…' : mode === 'create' ? 'Dar de alta' : 'Guardar cambios'}
        </Button>
      </form>
    </div>
  )
}
