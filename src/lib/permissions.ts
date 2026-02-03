// Role-based permissions system
import type { UserRole } from '@/types/database'

export type Permission = 
  | 'view_dashboard'
  | 'view_schedule'
  | 'view_customers'
  | 'manage_customers'
  | 'view_jobs'
  | 'manage_jobs'
  | 'view_own_jobs'
  | 'update_job_status'
  | 'add_job_notes'
  | 'add_job_photos'
  | 'view_quotes'
  | 'manage_quotes'
  | 'view_invoices'
  | 'manage_invoices'
  | 'view_requests'
  | 'manage_requests'
  | 'view_dispatch'
  | 'manage_dispatch'
  | 'view_tasks'
  | 'manage_tasks'
  | 'view_messages'
  | 'view_recurring'
  | 'manage_recurring'
  | 'view_marketing'
  | 'manage_marketing'
  | 'view_reports'
  | 'view_inventory'
  | 'manage_inventory'
  | 'view_expenses'
  | 'manage_expenses'
  | 'view_well_tools'
  | 'view_permit_research'
  | 'view_settings'
  | 'manage_settings'
  | 'manage_users'

// Define permissions for each role
const rolePermissions: Record<UserRole, Permission[]> = {
  admin: [
    'view_dashboard',
    'view_schedule',
    'view_customers',
    'manage_customers',
    'view_jobs',
    'manage_jobs',
    'view_own_jobs',
    'update_job_status',
    'add_job_notes',
    'add_job_photos',
    'view_quotes',
    'manage_quotes',
    'view_invoices',
    'manage_invoices',
    'view_requests',
    'manage_requests',
    'view_dispatch',
    'manage_dispatch',
    'view_tasks',
    'manage_tasks',
    'view_messages',
    'view_recurring',
    'manage_recurring',
    'view_marketing',
    'manage_marketing',
    'view_reports',
    'view_inventory',
    'manage_inventory',
    'view_expenses',
    'manage_expenses',
    'view_well_tools',
    'view_permit_research',
    'view_settings',
    'manage_settings',
    'manage_users',
  ],
  office: [
    'view_dashboard',
    'view_schedule',
    'view_customers',
    'manage_customers',
    'view_jobs',
    'manage_jobs',
    'view_own_jobs',
    'update_job_status',
    'add_job_notes',
    'add_job_photos',
    'view_quotes',
    'manage_quotes',
    'view_invoices',
    'manage_invoices',
    'view_requests',
    'manage_requests',
    'view_dispatch',
    'manage_dispatch',
    'view_tasks',
    'manage_tasks',
    'view_messages',
    'view_recurring',
    'manage_recurring',
    'view_marketing',
    'manage_marketing',
    'view_reports',
    'view_inventory',
    'manage_inventory',
    'view_expenses',
    'manage_expenses',
    'view_well_tools',
    'view_permit_research',
    // No settings access
  ],
  tech: [
    'view_dashboard',
    'view_schedule',
    'view_own_jobs',
    'update_job_status',
    'add_job_notes',
    'add_job_photos',
    'view_tasks',
    'view_messages',
  ],
  // Field is legacy/alias for tech
  field: [
    'view_dashboard',
    'view_schedule',
    'view_own_jobs',
    'update_job_status',
    'add_job_notes',
    'add_job_photos',
    'view_tasks',
    'view_messages',
  ],
}

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: UserRole | undefined | null, permission: Permission): boolean {
  if (!role) return false
  return rolePermissions[role]?.includes(permission) || false
}

/**
 * Check if a role has any of the specified permissions
 */
export function hasAnyPermission(role: UserRole | undefined | null, permissions: Permission[]): boolean {
  if (!role) return false
  return permissions.some(p => hasPermission(role, p))
}

/**
 * Check if a role has all of the specified permissions
 */
export function hasAllPermissions(role: UserRole | undefined | null, permissions: Permission[]): boolean {
  if (!role) return false
  return permissions.every(p => hasPermission(role, p))
}

/**
 * Get all permissions for a role
 */
export function getPermissions(role: UserRole | undefined | null): Permission[] {
  if (!role) return []
  return rolePermissions[role] || []
}

// Route to permission mapping for middleware
export const routePermissions: Record<string, Permission[]> = {
  '/': ['view_dashboard'],
  '/schedule': ['view_schedule'],
  '/customers': ['view_customers'],
  '/jobs': ['view_jobs', 'view_own_jobs'],
  '/jobs/my-jobs': ['view_own_jobs'],
  '/quotes': ['view_quotes'],
  '/invoices': ['view_invoices'],
  '/requests': ['view_requests'],
  '/dispatch': ['view_dispatch'],
  '/tasks': ['view_tasks'],
  '/messages': ['view_messages'],
  '/recurring': ['view_recurring'],
  '/marketing': ['view_marketing'],
  '/reports': ['view_reports'],
  '/inventory': ['view_inventory'],
  '/expenses': ['view_expenses'],
  '/well-tools': ['view_well_tools'],
  '/permits/research': ['view_permit_research'],
  '/settings': ['view_settings'],
}

/**
 * Check if a role can access a route
 */
export function canAccessRoute(role: UserRole | undefined | null, path: string): boolean {
  if (!role) return false
  
  // Admin can access everything
  if (role === 'admin') return true
  
  // Find matching route pattern
  for (const [route, permissions] of Object.entries(routePermissions)) {
    if (path === route || path.startsWith(route + '/')) {
      return hasAnyPermission(role, permissions)
    }
  }
  
  // Default: allow access to unknown routes (handled by page-level checks)
  return true
}

// Navigation visibility based on role
export interface NavItem {
  name: string
  href: string
  requiredPermissions?: Permission[]
}

/**
 * Filter navigation items based on role permissions
 */
export function filterNavItems(items: NavItem[], role: UserRole | undefined | null): NavItem[] {
  if (!role) return []
  if (role === 'admin') return items // Admin sees everything
  
  return items.filter(item => {
    if (!item.requiredPermissions) return true
    return hasAnyPermission(role, item.requiredPermissions)
  })
}

// Role display info
export const roleInfo: Record<UserRole, { label: string; description: string; color: string }> = {
  admin: {
    label: 'Admin',
    description: 'Full access to everything including billing, reports, and settings',
    color: 'bg-purple-100 text-purple-700',
  },
  office: {
    label: 'Office',
    description: 'Manage customers, jobs, invoices, reports — no settings access',
    color: 'bg-blue-100 text-blue-700',
  },
  tech: {
    label: 'Technician',
    description: 'View assigned jobs, update status, add notes and photos',
    color: 'bg-green-100 text-green-700',
  },
  field: {
    label: 'Field Tech',
    description: 'View assigned jobs, update status, add notes and photos',
    color: 'bg-green-100 text-green-700',
  },
}
