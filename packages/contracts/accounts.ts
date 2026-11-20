export const memberRoles = ['admin', 'operator', 'reader', 'superadmin'] as const
export const accountRoles = [...memberRoles, 'developer'] as const
export type MemberRole = typeof memberRoles[number]
export type Role = typeof accountRoles[number]

export type SuperadminPolicy = { dashboards: boolean; users: boolean }
export const defaultSuperadminPolicy: SuperadminPolicy = { dashboards: true, users: false }
export type AccountPermissions = { dashboards: boolean; users: boolean; roles: boolean }
export type Account = {
  id: string; tenant: string; email: string; name: string; role: Role; avatar?: number;
  permissions: AccountPermissions;
}
export const avatarCount = 20
export const roleLabels: Record<Role, string> = {
  developer: 'Developer', superadmin: 'Superadmin', admin: 'Admin satker', operator: 'Operator', reader: 'Pembaca',
}
