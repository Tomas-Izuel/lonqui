'use client'

import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { PageHeader } from '@/views/shared/page-header'
import { DataList, type DataListColumn, type DataListRow } from '@/views/shared/data-list'
import { RolePill } from '@/views/shared/status-pill'
import { Button } from '@/components/ui/button'
import { UserStatusBadges } from '@/views/users/user-status'
import { UserRowMenu } from '@/views/users/user-row-menu'
import { CreateUserDialog } from '@/views/users/create-user-dialog'
import { CompleteUserDialog } from '@/views/users/complete-user-dialog'
import { ChangeRoleDialog } from '@/views/users/change-role-dialog'
import { ToggleActiveDialog } from '@/views/users/toggle-active-dialog'
import { ResetPasswordDialog } from '@/views/users/reset-password-dialog'
import { TemporaryPasswordDialog, type TemporaryPasswordPayload } from '@/views/users/temporary-password-dialog'
import type { AppUserListItem } from '@/models/types'

/**
 * `/usuarios`, completa (spec F3). Recibe `users` ya resuelto por
 * `listUsers()` (page.tsx): esta vista no hace fetch. `currentUserId` viene
 * de la sesión para deshabilitar las acciones sobre la fila propia — el
 * backend las rechaza igual, esto es la UI explicándolo antes de intentar.
 *
 * Todo el árbol vive bajo un único límite `'use client'`: cada fila necesita
 * un menú de acciones interactivo, así que no hay una porción realista de
 * esta pantalla que se beneficie de quedar como Server Component. `users`
 * llega tal cual como prop (nunca se copia a estado local): un `createUser`/
 * `changeUserRole`/etc. exitoso llama `revalidatePath('/usuarios')`, y Next
 * re-renderiza esta misma ruta con el prop actualizado en la misma respuesta
 * de la Server Action — no hace falta refetch manual acá.
 */
export function UsersView({ users, currentUserId }: { users: AppUserListItem[]; currentUserId: string }) {
  const [createOpen, setCreateOpen] = useState(false)
  const [completeTarget, setCompleteTarget] = useState<AppUserListItem | null>(null)
  const [roleTarget, setRoleTarget] = useState<AppUserListItem | null>(null)
  const [activeTarget, setActiveTarget] = useState<AppUserListItem | null>(null)
  const [resetTarget, setResetTarget] = useState<AppUserListItem | null>(null)
  const [tempPassword, setTempPassword] = useState<TemporaryPasswordPayload | null>(null)

  function actionsFor(user: AppUserListItem) {
    return (
      <UserRowMenu
        user={user}
        isSelf={user.userId === currentUserId}
        onCompleteAlta={() => setCompleteTarget(user)}
        onChangeRole={() => setRoleTarget(user)}
        onToggleActive={() => setActiveTarget(user)}
        onResetPassword={() => setResetTarget(user)}
      />
    )
  }

  const columns: DataListColumn<AppUserListItem>[] = [
    {
      key: 'name',
      header: 'Nombre',
      render: (u) => (
        <span className="font-medium">
          {u.authStatus === 'incomplete' ? u.email : u.displayName}
          {u.userId === currentUserId ? <span className="ml-1.5 text-sm font-normal text-muted-foreground">(vos)</span> : null}
        </span>
      ),
    },
    { key: 'email', header: 'Email', render: (u) => (u.authStatus === 'incomplete' ? '—' : u.email) },
    { key: 'role', header: 'Rol', render: (u) => (u.authStatus === 'ok' ? <RolePill role={u.role} /> : '—') },
    { key: 'status', header: 'Estado', render: (u) => <UserStatusBadges user={u} /> },
    { key: 'actions', header: 'Acciones', className: 'text-right', render: (u) => <div className="flex justify-end">{actionsFor(u)}</div> },
  ]

  function renderRow(u: AppUserListItem): DataListRow {
    return {
      title: (
        <>
          {u.authStatus === 'incomplete' ? u.email : u.displayName}
          {u.userId === currentUserId ? <span className="ml-1.5 font-normal text-muted-foreground">(vos)</span> : null}
        </>
      ),
      // `subtitle` vive bajo `truncate` en `DataList` (una sola línea de
      // texto): nada de pills ahí, se cortarían. Rol y estado van en `meta`
      // (debajo del subtítulo, finish review fix 1): el menú es lo único a la
      // derecha, vía `actions`, así nunca compite por ancho con el título.
      subtitle: u.authStatus === 'incomplete' ? undefined : u.email,
      meta: (
        <>
          {u.authStatus === 'ok' ? <RolePill role={u.role} /> : null}
          <UserStatusBadges user={u} />
        </>
      ),
      actions: actionsFor(u),
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* El botón "Nuevo usuario" sin override de alto: hereda el h-11 (44px)
          flat del `Button` base — antes achicaba a h-8 (32px) desde `sm:`,
          bajo el piso táctil. */}
      <PageHeader
        title="Usuarios"
        description="Quién de la Comisión entra al sistema y con qué permiso."
        action={
          <Button type="button" onClick={() => setCreateOpen(true)} className="gap-1.5">
            <UserPlus aria-hidden />
            Nuevo usuario
          </Button>
        }
      />

      {/* Cada fila muestra el estado como pill/badge CON texto (piso de calidad: nunca solo color). */}
      <DataList items={users} getKey={(u) => u.userId} columns={columns} renderRow={renderRow} />

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(password, displayName) => setTempPassword({ password, forLabel: displayName })}
      />
      <CompleteUserDialog
        user={completeTarget}
        open={completeTarget !== null}
        onOpenChange={(open) => !open && setCompleteTarget(null)}
        onCompleted={(password, displayName) => {
          setCompleteTarget(null)
          setTempPassword({ password, forLabel: displayName })
        }}
      />
      <ChangeRoleDialog user={roleTarget} open={roleTarget !== null} onOpenChange={(open) => !open && setRoleTarget(null)} />
      <ToggleActiveDialog user={activeTarget} open={activeTarget !== null} onOpenChange={(open) => !open && setActiveTarget(null)} />
      <ResetPasswordDialog
        user={resetTarget}
        open={resetTarget !== null}
        onOpenChange={(open) => !open && setResetTarget(null)}
        onReset={(password, displayName) => {
          setResetTarget(null)
          setTempPassword({ password, forLabel: displayName })
        }}
      />
      <TemporaryPasswordDialog payload={tempPassword} onOpenChange={(open) => !open && setTempPassword(null)} />
    </div>
  )
}
