'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useWatch, type Path } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel } from '@/views/shared/panel'
import { CheckboxField, DateField, DniField, PhoneField, TextField, TextareaField } from '@/views/shared/form-fields'
import { DateText } from '@/views/shared/date-text'
import { memberStatusLabels } from '@/views/shared/labels'
import { toClubDate } from '@/lib/dates'
import { CategorySelector } from '@/views/members/category-selector'
import { FamilyGroupCombobox, NO_GROUP, NEW_GROUP } from '@/views/members/family-group-combobox'
import { createFamilyGroup, createMember, setMemberCategories, updateMember } from '@/controllers/members.actions'
import type { DisciplineWithCategories, FamilyGroupSummary, MemberDetail } from '@/models/types'

/** Mismo `categoryId` elegido, sin importar el orden: alta y baja de deportes son un cambio de conjunto, no de secuencia. */
function sameCategorySet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const setB = new Set(b)
  return a.every((id) => setB.has(id))
}

/**
 * Shape del formulario en el cliente. Selects van como `string` (Radix
 * `Select` no maneja números) y se convierten a `number | undefined` recién
 * al armar el payload para la Server Action — el schema real (`members.model.ts`,
 * B2) vive en el servidor; esto es validación de formato para no ir y volver
 * por cada error obvio.
 *
 * Revisión 3 (§13.6): `memberType`/`disciplineId`/`categoryId` desaparecen;
 * `categoryIds` (vacío = no practicante) es la sección "Deportes y
 * categorías". `effectiveOn` ("a partir de") solo se usa en edición, y solo
 * cuando la selección cambió respecto de la inicial.
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
  categoryIds: z.array(z.number()),
  effectiveOn: z.string(),
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
}

/**
 * `joinedOn` vive en el mismo schema en los dos modos (evita dos tipos de
 * formulario distintos); solo se exige/valida en `create`. `initialCategoryIds`
 * (edición) habilita "A partir de" únicamente si la selección cambió — sin
 * cambio, no hace falta pedir una fecha que no se va a usar.
 */
function buildSchema(mode: 'create' | 'edit', initialCategoryIds: number[]) {
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
      } else if (!sameCategorySet(data.categoryIds, initialCategoryIds)) {
        if (!data.effectiveOn) {
          ctx.addIssue({ code: 'custom', message: 'Elegí a partir de cuándo', path: ['effectiveOn'] })
        } else if (data.effectiveOn > toClubDate()) {
          ctx.addIssue({ code: 'custom', message: 'La fecha no puede ser futura', path: ['effectiveOn'] })
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
  'categoryIds',
  'effectiveOn',
  'joinedOn',
  'notes',
] as const

function isKnownField(field: string | undefined): field is Path<FormValues> {
  return (KNOWN_FIELDS as readonly string[]).includes(field ?? '')
}

/** Un deporte que se agrega o se deja, para la consecuencia escrita bajo "A partir de" (§13.6). */
function describeCategoryChanges(
  initialCategoryIds: number[],
  currentCategoryIds: number[],
  disciplines: DisciplineWithCategories[],
): string[] {
  const disciplineByCategory = new Map<number, string>()
  for (const discipline of disciplines) {
    for (const category of discipline.categories) disciplineByCategory.set(category.id, discipline.name)
  }
  const disciplineNamesOf = (categoryIds: number[]): Set<string> => {
    const names = new Set<string>()
    for (const id of categoryIds) {
      const name = disciplineByCategory.get(id)
      if (name != null) names.add(name)
    }
    return names
  }

  const initialDisciplines = disciplineNamesOf(initialCategoryIds)
  const currentDisciplines = disciplineNamesOf(currentCategoryIds)

  const messages: string[] = []
  for (const disciplineName of initialDisciplines) {
    if (!currentDisciplines.has(disciplineName)) {
      messages.push(`Deja de generar cuota de ${disciplineName} desde el mes siguiente; la de este mes queda.`)
    }
  }
  for (const disciplineName of currentDisciplines) {
    if (!initialDisciplines.has(disciplineName)) {
      messages.push(`Empieza a pagar ${disciplineName} desde este mes.`)
    }
  }
  return messages
}

export type MemberFormProps =
  | { mode: 'create'; member?: undefined; disciplines: DisciplineWithCategories[]; familyGroups: FamilyGroupSummary[] }
  | { mode: 'edit'; member: MemberDetail; disciplines: DisciplineWithCategories[]; familyGroups: FamilyGroupSummary[] }

/**
 * Ficha de ingreso y edición (route-socios-nuevo.md + Revisión 3 §13.6): el
 * mismo formulario en los dos modos, sin `joinedOn` ni `status` editables en
 * edición. Una sola columna, secciones cortas como `Panel` hermanos (nunca
 * anidados).
 *
 * En edición, los deportes NO se guardan con `updateMember` (que ya no acepta
 * `categoryIds`, B3): si la selección cambió, un segundo llamado a
 * `setMemberCategories` la aplica con "a partir de". Si el primer guardado
 * (datos personales) sale bien pero el segundo (deportes) falla, el socio
 * queda guardado igual — se avisa y se vuelve a la ficha, mismo criterio que
 * el residual aceptado y documentado del alta (B3, dev log).
 */
export function MemberForm({ mode, member, disciplines, familyGroups }: MemberFormProps) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const initialCategoryIds = member?.categories.map((c) => c.categoryId) ?? []
  const defaultFamilyChoice = member?.familyGroupId != null ? String(member.familyGroupId) : NO_GROUP

  const form = useForm<FormValues>({
    resolver: zodResolver(buildSchema(mode, initialCategoryIds)),
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
      categoryIds: initialCategoryIds,
      effectiveOn: mode === 'edit' ? toClubDate() : '',
      familyGroupChoice: defaultFamilyChoice,
      newGroupName: '',
      newGroupPayerContactName: '',
      newGroupPayerContactPhone: '',
      notes: member?.notes ?? '',
      joinedOn: mode === 'create' ? toClubDate() : '',
    },
  })

  const categoryIds = useWatch({ control: form.control, name: 'categoryIds' })
  const familyGroupChoice = useWatch({ control: form.control, name: 'familyGroupChoice' })
  const dniPending = useWatch({ control: form.control, name: 'dniPending' })

  const categoriesChanged = mode === 'edit' && !sameCategorySet(categoryIds, initialCategoryIds)
  const categoryConsequences = categoriesChanged ? describeCategoryChanges(initialCategoryIds, categoryIds, disciplines) : []

  // DNI pendiente: se limpia el DNI cargado (son mutuamente excluyentes, igual que en el servidor).
  useEffect(() => {
    if (dniPending) form.setValue('dni', '')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando cambia el check
  }, [dniPending])

  async function onValid(values: FormValues) {
    setServerError(null)

    const shared = {
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      dni: values.dniPending ? undefined : values.dni.trim() || undefined,
      dniPending: values.dniPending || undefined,
      birthDate: values.birthDate || undefined,
      address: values.address.trim() || undefined,
      phone: values.phone.trim() || undefined,
      email: values.email.trim() || undefined,
      notes: values.notes.trim() || undefined,
    }

    if (mode === 'create') {
      // El grupo nuevo lo crea `createMember` DESPUÉS de validar al socio
      // (03-review.md, minor 10): antes se creaba acá primero, y un alta que
      // fallaba (DNI duplicado, por ejemplo) dejaba un grupo vacío huérfano
      // en el select de todas las fichas siguientes.
      const result = await createMember({
        ...shared,
        joinedOn: values.joinedOn,
        categoryIds: values.categoryIds,
        familyGroupId:
          values.familyGroupChoice !== NO_GROUP && values.familyGroupChoice !== NEW_GROUP
            ? Number(values.familyGroupChoice)
            : undefined,
        newFamilyGroup:
          values.familyGroupChoice === NEW_GROUP
            ? {
                name: values.newGroupName.trim() || undefined,
                payerContactName: values.newGroupPayerContactName.trim() || undefined,
                payerContactPhone: values.newGroupPayerContactPhone.trim() || undefined,
              }
            : undefined,
      })
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

    // Edición: `updateMember` todavía no acepta `newFamilyGroup` (fuera del
    // contrato de esta tanda, solo `createMember` lo suma) — se mantiene el
    // flujo anterior de crear el grupo antes de guardar. El caso que
    // describe el hallazgo (responsable que sale de su grupo) lo cierra el
    // trigger de Postgres del hallazgo 3, no esta vista.
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

    const result = await updateMember(member!.id, { ...shared, familyGroupId })
    if (!result.ok) {
      if (isKnownField(result.field)) {
        form.setError(result.field, { message: result.error })
        form.setFocus(result.field)
      } else {
        setServerError(result.error)
      }
      return
    }

    if (categoriesChanged) {
      const categoriesResult = await setMemberCategories({
        memberId: member!.id,
        categoryIds: values.categoryIds,
        effectiveOn: values.effectiveOn,
      })
      if (!categoriesResult.ok) {
        // Los datos personales YA se guardaron (commit propio): se avisa del
        // residual en vez de dejar la pantalla como si nada hubiera pasado.
        toast.error(`Se guardaron los datos, pero no pudimos actualizar los deportes: ${categoriesResult.error}`)
        if (isKnownField(categoriesResult.field)) {
          form.setError(categoriesResult.field, { message: categoriesResult.error })
          return
        }
        router.push(`/socios/${member!.id}`)
        return
      }
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

      <form onSubmit={form.handleSubmit(onValid)} noValidate method="post" className="flex flex-col gap-4">
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

        <Panel title="Deportes y categorías">
          <div className="flex flex-col gap-4">
            <CategorySelector
              disciplines={disciplines}
              value={categoryIds}
              onChange={(next) => form.setValue('categoryIds', next, { shouldValidate: true })}
              disabled={pending}
              error={form.formState.errors.categoryIds?.message}
            />
            {categoriesChanged ? (
              <div className="flex flex-col gap-3 border-t border-border pt-4">
                <DateField
                  control={form.control}
                  name="effectiveOn"
                  label="A partir de"
                  max={toClubDate()}
                  disabled={pending}
                />
                <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                  {categoryConsequences.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="Grupo familiar">
          <div className="flex flex-col gap-4">
            <FamilyGroupCombobox control={form.control} name="familyGroupChoice" familyGroups={familyGroups} disabled={pending} />
            {familyGroupChoice === NEW_GROUP ? (
              // Separador, no tarjeta: un `Panel` nunca contiene otra (piso de
              // calidad, 03-review.md minor 12), mismo patrón que `FamilyGroupSection`.
              <div className="flex flex-col gap-4 border-t border-border pt-4">
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
