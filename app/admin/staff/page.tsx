"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Copy, KeyRound, Plus, Search, ShieldCheck, Trash2, UserCog } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type StaffMember = {
  id: string
  email: string
  username: string
  displayName: string
  role: string
  roleId: string | null
  roleRef?: { id: string; name: string; slug: string } | null
  isActive: boolean
  createdAt: string
  lastLogin: string | null
}

type Permission = { id: string; key: string; module: string; description: string | null }
type Role = { id: string; name: string; slug: string; description: string | null; isSystem: boolean; adminCount: number; permissions: string[] }

const emptyAdmin = { displayName: "", username: "", email: "", password: "", roleId: "" }
const emptyRole = { name: "", description: "", cloneFromId: "" }

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&"
  return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
}

function groupPermissions(permissions: Permission[]) {
  return permissions.reduce<Record<string, Permission[]>>((groups, permission) => {
    groups[permission.module] ||= []
    groups[permission.module].push(permission)
    return groups
  }, {})
}

export default function AdminStaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [savingId, setSavingId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [permissionQuery, setPermissionQuery] = useState("")
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
  const [createAdminOpen, setCreateAdminOpen] = useState(false)
  const [createRoleOpen, setCreateRoleOpen] = useState(false)
  const [adminForm, setAdminForm] = useState(emptyAdmin)
  const [roleForm, setRoleForm] = useState(emptyRole)
  const [resetPasswordFor, setResetPasswordFor] = useState<StaffMember | null>(null)
  const [resetPassword, setResetPassword] = useState("")

  async function load() {
    const [staffRes, rolesRes] = await Promise.all([fetch("/api/admin/staff"), fetch("/api/admin/roles")])
    const staffData = await readJsonResponse<any>(staffRes)
    const rolesData = await readJsonResponse<any>(rolesRes)
    if (!staffRes.ok) toast.error(staffData.error || "Failed to load staff")
    if (!rolesRes.ok) toast.error(rolesData.error || "Failed to load roles")
    setStaff(staffData.staff || [])
    setRoles(rolesData.roles || [])
    setPermissions(rolesData.permissions || [])
    setSelectedRoleId((current) => current || rolesData.roles?.[0]?.id || null)
    setAdminForm((current) => ({ ...current, roleId: current.roleId || rolesData.roles?.find((role: Role) => role.slug === "support_agent")?.id || rolesData.roles?.[0]?.id || "" }))
  }

  useEffect(() => {
    void load()
  }, [])

  const selectedRole = roles.find((role) => role.id === selectedRoleId) || null
  const visiblePermissions = useMemo(() => {
    const text = permissionQuery.trim().toLowerCase()
    if (!text) return permissions
    return permissions.filter((permission) => [permission.key, permission.module, permission.description].join(" ").toLowerCase().includes(text))
  }, [permissionQuery, permissions])
  const permissionGroups = useMemo(() => groupPermissions(visiblePermissions), [visiblePermissions])
  const filteredStaff = staff.filter((member) => [member.displayName, member.email, member.username, member.roleRef?.name].join(" ").toLowerCase().includes(query.toLowerCase()))

  async function updateStaff(id: string, payload: Partial<Pick<StaffMember, "isActive" | "roleId" | "displayName">>) {
    setSavingId(id)
    const res = await fetch(`/api/admin/staff/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const data = await readJsonResponse<any>(res)
    setSavingId(null)
    if (!res.ok) return toast.error(data.error || "Failed to update staff member")
    toast.success("Staff member updated")
    await load()
  }

  async function createAdmin() {
    const res = await fetch("/api/admin/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(adminForm),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Failed to create admin")
    toast.success("Admin created")
    setCreateAdminOpen(false)
    setAdminForm({ ...emptyAdmin, roleId: roles[0]?.id || "" })
    await load()
  }

  async function deleteAdmin(member: StaffMember) {
    if (!confirm(`Delete admin ${member.email}?`)) return
    const res = await fetch(`/api/admin/staff/${member.id}`, { method: "DELETE" })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Failed to delete admin")
    toast.success("Admin deleted")
    await load()
  }

  async function resetAdminPassword() {
    if (!resetPasswordFor) return
    const res = await fetch(`/api/admin/staff/${resetPasswordFor.id}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: resetPassword }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Failed to reset password")
    toast.success("Password reset and sessions invalidated")
    setResetPasswordFor(null)
    setResetPassword("")
  }

  async function createRole() {
    const res = await fetch("/api/admin/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(roleForm),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Failed to create role")
    toast.success("Role created")
    setCreateRoleOpen(false)
    setRoleForm(emptyRole)
    await load()
    setSelectedRoleId(data.role?.id || null)
  }

  async function saveRole(nextPermissions = selectedRole?.permissions || []) {
    if (!selectedRole) return
    setSavingId(selectedRole.id)
    const res = await fetch(`/api/admin/roles/${selectedRole.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...selectedRole, permissions: nextPermissions }),
    })
    const data = await readJsonResponse<any>(res)
    setSavingId(null)
    if (!res.ok) return toast.error(data.error || "Failed to update role")
    toast.success("Role permissions updated")
    await load()
  }

  function updateSelectedRole(patch: Partial<Pick<Role, "name" | "description" | "permissions">>) {
    if (!selectedRole) return
    setRoles((current) => current.map((role) => role.id === selectedRole.id ? { ...role, ...patch } : role))
  }

  async function deleteRole(role: Role) {
    if (!confirm(`Delete role ${role.name}?`)) return
    const res = await fetch(`/api/admin/roles/${role.id}`, { method: "DELETE" })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Failed to delete role")
    toast.success("Role deleted")
    await load()
  }

  function togglePermission(key: string, checked: boolean) {
    if (!selectedRole) return
    const next = checked ? Array.from(new Set([...selectedRole.permissions, key])) : selectedRole.permissions.filter((item) => item !== key)
    updateSelectedRole({ permissions: next })
  }

  function roleSelect(value: string, onValueChange: (value: string) => void, disabled = false) {
    return (
      <Select value={value || undefined} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger className="h-10 w-full">
          <SelectValue placeholder="Select role" />
        </SelectTrigger>
        <SelectContent>
          {roles.map((role) => <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>)}
        </SelectContent>
      </Select>
    )
  }

  function formatLastLogin(value: string | null) {
    if (!value) return "Never"
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Admin Access</h1>
          <p className="mt-1 text-muted-foreground">Manage staff accounts, roles, and permission-based admin access.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Dialog open={createRoleOpen} onOpenChange={setCreateRoleOpen}>
            <DialogTrigger asChild><Button variant="outline"><ShieldCheck className="h-4 w-4" /> New role</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create role</DialogTitle><DialogDescription>Clone an existing role or start with no permissions.</DialogDescription></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2"><Label>Name</Label><Input value={roleForm.name} onChange={(event) => setRoleForm({ ...roleForm, name: event.target.value })} /></div>
                <div className="space-y-2"><Label>Description</Label><Input value={roleForm.description} onChange={(event) => setRoleForm({ ...roleForm, description: event.target.value })} /></div>
                <div className="space-y-2">
                  <Label>Clone permissions from</Label>
                  <Select value={roleForm.cloneFromId || "empty"} onValueChange={(cloneFromId) => setRoleForm({ ...roleForm, cloneFromId: cloneFromId === "empty" ? "" : cloneFromId })}>
                    <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="empty">Empty role</SelectItem>
                      {roles.map((role) => <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter><Button onClick={createRole}>Create role</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={createAdminOpen} onOpenChange={setCreateAdminOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> New admin</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create admin</DialogTitle><DialogDescription>Create a staff account and assign a role.</DialogDescription></DialogHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Name</Label><Input value={adminForm.displayName} onChange={(event) => setAdminForm({ ...adminForm, displayName: event.target.value })} /></div>
                <div className="space-y-2"><Label>Username</Label><Input value={adminForm.username} onChange={(event) => setAdminForm({ ...adminForm, username: event.target.value })} /></div>
                <div className="space-y-2 sm:col-span-2"><Label>Email</Label><Input value={adminForm.email} onChange={(event) => setAdminForm({ ...adminForm, email: event.target.value })} /></div>
                <div className="space-y-2"><Label>Role</Label>{roleSelect(adminForm.roleId, (roleId) => setAdminForm({ ...adminForm, roleId }))}</div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <div className="flex gap-2"><Input value={adminForm.password} onChange={(event) => setAdminForm({ ...adminForm, password: event.target.value })} /><Button type="button" variant="outline" onClick={() => setAdminForm({ ...adminForm, password: randomPassword() })}><Copy className="h-4 w-4" /></Button></div>
                </div>
              </div>
              <DialogFooter><Button onClick={createAdmin}>Create admin</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="admins" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 sm:w-fit"><TabsTrigger value="admins"><UserCog className="h-4 w-4" /> Admins</TabsTrigger><TabsTrigger value="roles"><ShieldCheck className="h-4 w-4" /> Roles</TabsTrigger></TabsList>
        <TabsContent value="admins">
          <Card className="glass border-border/40">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div><CardTitle>Admin Management</CardTitle><CardDescription>Create, suspend, delete, reset passwords, and assign roles.</CardDescription></div>
                <div className="relative sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search admins" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {filteredStaff.map((member) => (
                  <div key={member.id} className="rounded-lg border border-border/40 bg-background/35 p-4">
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px_160px_auto] xl:items-center">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{member.displayName}</div>
                        <div className="truncate text-sm text-muted-foreground">{member.email} · @{member.username}</div>
                        <div className="mt-1 text-xs text-muted-foreground">Last login: {formatLastLogin(member.lastLogin)}</div>
                      </div>
                      {roleSelect(member.roleId || "", (roleId) => void updateStaff(member.id, { roleId }), savingId === member.id)}
                      <Button variant={member.isActive ? "outline" : "default"} onClick={() => void updateStaff(member.id, { isActive: !member.isActive })} disabled={savingId === member.id}>{member.isActive ? "Suspend" : "Activate"}</Button>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="icon" onClick={() => { setResetPasswordFor(member); setResetPassword(randomPassword()) }} aria-label="Reset password"><KeyRound className="h-4 w-4" /></Button>
                        <Button variant="outline" size="icon" onClick={() => void deleteAdmin(member)} aria-label="Delete admin"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  </div>
                ))}
                {!filteredStaff.length ? <div className="py-10 text-center text-muted-foreground">No staff accounts found.</div> : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="roles">
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <Card className="glass border-border/40"><CardHeader><CardTitle>Roles</CardTitle><CardDescription>System and custom staff roles.</CardDescription></CardHeader><CardContent className="space-y-2">{roles.map((role) => <button key={role.id} type="button" onClick={() => setSelectedRoleId(role.id)} className={`w-full rounded-lg border p-3 text-left transition ${selectedRoleId === role.id ? "selected-item" : "border-border/40 bg-background/30 hover:bg-white/[0.04]"}`}><div className="flex items-center justify-between gap-2"><span className="font-medium">{role.name}</span>{role.isSystem ? <Badge variant="secondary">System</Badge> : null}</div><div className="mt-1 text-xs text-muted-foreground">{role.adminCount} admins · {role.permissions.length} permissions</div></button>)}</CardContent></Card>
            <Card className="glass border-border/40">
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div><CardTitle>{selectedRole?.name || "Permission Matrix"}</CardTitle><CardDescription>{selectedRole?.description || "Select a role to edit permissions."}</CardDescription></div>
                  {selectedRole ? <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => updateSelectedRole({ permissions: permissions.map((permission) => permission.key) })}>Select all</Button><Button variant="outline" onClick={() => updateSelectedRole({ permissions: [] })}>Clear all</Button><Button onClick={() => void saveRole()} disabled={savingId === selectedRole.id}>Save</Button>{!selectedRole.isSystem ? <Button variant="outline" onClick={() => void deleteRole(selectedRole)}><Trash2 className="h-4 w-4" /></Button> : null}</div> : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {selectedRole ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Role name</Label>
                      <Input value={selectedRole.name} disabled={selectedRole.isSystem} onChange={(event) => updateSelectedRole({ name: event.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Description</Label>
                      <Input value={selectedRole.description || ""} onChange={(event) => updateSelectedRole({ description: event.target.value })} />
                    </div>
                    <div className="relative md:col-span-2">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input className="pl-9" placeholder="Search permissions" value={permissionQuery} onChange={(event) => setPermissionQuery(event.target.value)} />
                    </div>
                  </div>
                ) : null}
                {selectedRole ? Object.entries(permissionGroups).map(([module, items]) => (
                  <section key={module} className="rounded-lg border border-border/40 bg-background/30 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-medium capitalize">{module}</h3><Button variant="ghost" size="sm" onClick={() => { const keys = items.map((item) => item.key); const allOn = keys.every((key) => selectedRole.permissions.includes(key)); const next = allOn ? selectedRole.permissions.filter((key) => !keys.includes(key)) : Array.from(new Set([...selectedRole.permissions, ...keys])); updateSelectedRole({ permissions: next }) }}>{items.every((item) => selectedRole.permissions.includes(item.key)) ? "Clear" : "Select"} module</Button></div>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {items.map((permission) => <label key={permission.key} className="flex min-h-16 gap-3 rounded-md border border-border/30 bg-black/10 p-3"><Checkbox checked={selectedRole.permissions.includes(permission.key)} onCheckedChange={(checked) => togglePermission(permission.key, checked === true)} /><span><span className="block text-sm font-medium">{permission.key}</span><span className="text-xs text-muted-foreground">{permission.description}</span></span></label>)}
                    </div>
                  </section>
                )) : null}
                {selectedRole && !Object.keys(permissionGroups).length ? <div className="rounded-lg border border-border/40 p-6 text-center text-sm text-muted-foreground">No permissions match your search.</div> : null}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(resetPasswordFor)} onOpenChange={(open) => !open && setResetPasswordFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reset password</DialogTitle><DialogDescription>Active sessions for this admin will be invalidated.</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label>New password for {resetPasswordFor?.email}</Label><Input value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} /></div>
          <DialogFooter><Button onClick={resetAdminPassword}>Reset password</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
