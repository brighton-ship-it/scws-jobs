'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { 
  Users, 
  Plus, 
  Search,
  MoreVertical,
  Copy,
  Edit,
  Trash,
  MapPin,
  Wrench,
  Filter,
  RefreshCw,
  Loader2,
  AlertCircle
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'

interface SegmentCondition {
  field: string
  operator: string
  value: string
}

interface Segment {
  id: string
  name: string
  description?: string
  type: string
  customer_count: number
  conditions: SegmentCondition[]
  is_dynamic: boolean
  created_at: string
  updated_at: string
}

const typeIcons: Record<string, any> = {
  system: Users,
  custom: Filter,
  location: MapPin,
  service: Wrench,
  dynamic: RefreshCw,
}

const typeColors: Record<string, string> = {
  system: 'bg-gray-100 text-gray-800',
  custom: 'bg-blue-100 text-blue-800',
  location: 'bg-green-100 text-green-800',
  service: 'bg-orange-100 text-orange-800',
  dynamic: 'bg-purple-100 text-purple-800',
}

export default function SegmentsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [segments, setSegments] = useState<Segment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Create dialog
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newSegment, setNewSegment] = useState({
    name: '',
    description: '',
    type: 'custom',
    is_dynamic: false,
  })
  const [conditions, setConditions] = useState<SegmentCondition[]>([{ field: '', operator: '', value: '' }])
  const [creating, setCreating] = useState(false)
  
  // Edit dialog
  const [editSegment, setEditSegment] = useState<Segment | null>(null)
  const [editData, setEditData] = useState({
    name: '',
    description: '',
    is_dynamic: false,
  })
  const [editConditions, setEditConditions] = useState<SegmentCondition[]>([])
  const [saving, setSaving] = useState(false)
  
  // Delete
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Fetch segments
  useEffect(() => {
    async function fetchSegments() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/marketing/segments')
        if (!res.ok) throw new Error('Failed to fetch segments')
        const data = await res.json()
        setSegments(data.segments || [])
      } catch (err: any) {
        console.error('Error fetching segments:', err)
        setError(err.message || 'Failed to load segments')
      } finally {
        setLoading(false)
      }
    }
    fetchSegments()
  }, [])

  const addCondition = () => {
    setConditions([...conditions, { field: '', operator: '', value: '' }])
  }

  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index))
  }

  const updateCondition = (index: number, field: keyof SegmentCondition, value: string) => {
    const updated = [...conditions]
    updated[index] = { ...updated[index], [field]: value }
    setConditions(updated)
  }

  const addEditCondition = () => {
    setEditConditions([...editConditions, { field: '', operator: '', value: '' }])
  }

  const removeEditCondition = (index: number) => {
    setEditConditions(editConditions.filter((_, i) => i !== index))
  }

  const updateEditCondition = (index: number, field: keyof SegmentCondition, value: string) => {
    const updated = [...editConditions]
    updated[index] = { ...updated[index], [field]: value }
    setEditConditions(updated)
  }

  // Create segment
  const handleCreate = async () => {
    if (!newSegment.name) {
      toast.error('Please enter a segment name')
      return
    }
    
    setCreating(true)
    try {
      const validConditions = conditions.filter(c => c.field && c.operator && c.value)
      const res = await fetch('/api/marketing/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSegment.name,
          description: newSegment.description || null,
          type: newSegment.type,
          conditions: validConditions,
          is_dynamic: newSegment.is_dynamic,
        }),
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create segment')
      }
      
      const data = await res.json()
      setSegments([data.segment, ...segments])
      setIsCreateOpen(false)
      setNewSegment({ name: '', description: '', type: 'custom', is_dynamic: false })
      setConditions([{ field: '', operator: '', value: '' }])
      toast.success('Segment created')
    } catch (err: any) {
      toast.error(err.message || 'Failed to create segment')
    } finally {
      setCreating(false)
    }
  }

  // Edit segment
  const handleEdit = async () => {
    if (!editSegment) return
    
    setSaving(true)
    try {
      const validConditions = editConditions.filter(c => c.field && c.operator && c.value)
      const res = await fetch(`/api/marketing/segments/${editSegment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editData.name,
          description: editData.description || null,
          conditions: validConditions,
          is_dynamic: editData.is_dynamic,
        }),
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update segment')
      }
      
      const data = await res.json()
      setSegments(segments.map(s => s.id === editSegment.id ? data.segment : s))
      setEditSegment(null)
      toast.success('Segment updated')
    } catch (err: any) {
      toast.error(err.message || 'Failed to update segment')
    } finally {
      setSaving(false)
    }
  }

  // Delete segment
  const handleDelete = async () => {
    if (!deleteId) return
    
    setDeleting(true)
    try {
      const res = await fetch(`/api/marketing/segments/${deleteId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete segment')
      }
      setSegments(segments.filter(s => s.id !== deleteId))
      toast.success('Segment deleted')
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete segment')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  // Duplicate segment
  const handleDuplicate = async (segment: Segment) => {
    try {
      const res = await fetch('/api/marketing/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${segment.name} (Copy)`,
          description: segment.description,
          type: 'custom',
          conditions: segment.conditions,
          is_dynamic: segment.is_dynamic,
        }),
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to duplicate segment')
      }
      
      const data = await res.json()
      setSegments([data.segment, ...segments])
      toast.success('Segment duplicated')
    } catch (err: any) {
      toast.error(err.message || 'Failed to duplicate segment')
    }
  }

  const openEditDialog = (segment: Segment) => {
    setEditSegment(segment)
    setEditData({
      name: segment.name,
      description: segment.description || '',
      is_dynamic: segment.is_dynamic,
    })
    setEditConditions(segment.conditions?.length > 0 
      ? segment.conditions 
      : [{ field: '', operator: '', value: '' }]
    )
  }

  const filteredSegments = segments.filter(segment =>
    segment.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (segment.description || '').toLowerCase().includes(searchQuery.toLowerCase())
  )

  const totalCustomers = segments.find(s => s.type === 'system' && s.name === 'All Customers')?.customer_count || 
    segments.reduce((max, s) => Math.max(max, s.customer_count || 0), 0)

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-muted-foreground">{error}</p>
        <Button onClick={() => window.location.reload()}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/marketing" className="text-muted-foreground hover:text-foreground">
              Marketing
            </Link>
            <span className="text-muted-foreground">/</span>
            <h1 className="text-3xl font-bold tracking-tight">Segments</h1>
          </div>
          <p className="text-muted-foreground">
            Target specific groups of customers for your campaigns
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Segment
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Create Segment</DialogTitle>
              <DialogDescription>
                Define conditions to group customers for targeted campaigns
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Segment Name *</Label>
                <Input 
                  id="name" 
                  placeholder="e.g., Customers needing maintenance" 
                  value={newSegment.name}
                  onChange={(e) => setNewSegment({ ...newSegment, name: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">Description</Label>
                <Input 
                  id="description" 
                  placeholder="Brief description of this segment" 
                  value={newSegment.description}
                  onChange={(e) => setNewSegment({ ...newSegment, description: e.target.value })}
                />
              </div>
              
              <div className="space-y-3">
                <Label>Conditions</Label>
                <p className="text-sm text-muted-foreground">
                  Customers matching ALL conditions will be included
                </p>
                {conditions.map((condition, index) => (
                  <div key={index} className="flex gap-2 items-start">
                    <Select 
                      value={condition.field}
                      onValueChange={(v) => updateCondition(index, 'field', v)}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Select field" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="last_service">Last Service Date</SelectItem>
                        <SelectItem value="city">City/Location</SelectItem>
                        <SelectItem value="service_type">Service Type</SelectItem>
                        <SelectItem value="total_spend">Total Spend</SelectItem>
                        <SelectItem value="quote_status">Quote Status</SelectItem>
                        <SelectItem value="next_appointment">Next Appointment</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={condition.operator}
                      onValueChange={(v) => updateCondition(index, 'operator', v)}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder="Operator" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="equals">equals</SelectItem>
                        <SelectItem value="not_equals">not equals</SelectItem>
                        <SelectItem value="greater_than">greater than</SelectItem>
                        <SelectItem value="less_than">less than</SelectItem>
                        <SelectItem value="within">within</SelectItem>
                        <SelectItem value="more_than">more than</SelectItem>
                        <SelectItem value="includes">includes</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input 
                      placeholder="Value" 
                      className="flex-1" 
                      value={condition.value}
                      onChange={(e) => updateCondition(index, 'value', e.target.value)}
                    />
                    {conditions.length > 1 && (
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => removeCondition(index)}
                      >
                        <Trash className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addCondition}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Condition
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={creating}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create Segment'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Customers</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCustomers.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">In database</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Custom Segments</CardTitle>
            <Filter className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {segments.filter(s => s.type === 'custom').length}
            </div>
            <p className="text-xs text-muted-foreground">User-defined</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Location Segments</CardTitle>
            <MapPin className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {segments.filter(s => s.type === 'location').length}
            </div>
            <p className="text-xs text-muted-foreground">Geographic targeting</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Service Segments</CardTitle>
            <Wrench className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {segments.filter(s => s.type === 'service').length}
            </div>
            <p className="text-xs text-muted-foreground">By service type</p>
          </CardContent>
        </Card>
      </div>

      {/* Segments List */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <CardTitle>All Segments</CardTitle>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search segments..."
                className="pl-8 w-[250px]"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {filteredSegments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {segments.length === 0 ? (
                  <div className="space-y-2">
                    <p>No segments yet</p>
                    <Button variant="outline" size="sm" onClick={() => setIsCreateOpen(true)}>
                      <Plus className="mr-2 h-4 w-4" />
                      Create your first segment
                    </Button>
                  </div>
                ) : (
                  'No segments found'
                )}
              </div>
            ) : (
              filteredSegments.map((segment) => {
                const TypeIcon = typeIcons[segment.type] || Users
                const conditions = segment.conditions || []
                return (
                  <div 
                    key={segment.id}
                    className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-full ${typeColors[segment.type] || 'bg-gray-100 text-gray-800'}`}>
                        <TypeIcon className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">{segment.name}</h4>
                          {segment.is_dynamic && (
                            <Badge variant="outline" className="text-xs">
                              <RefreshCw className="mr-1 h-3 w-3" />
                              Auto-updates
                            </Badge>
                          )}
                        </div>
                        {segment.description && (
                          <p className="text-sm text-muted-foreground">{segment.description}</p>
                        )}
                        {conditions.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {conditions.map((cond, i) => (
                              <Badge key={i} variant="secondary" className="text-xs">
                                {cond.field} {cond.operator} {cond.value}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-2xl font-bold">{(segment.customer_count || 0).toLocaleString()}</div>
                        <div className="text-xs text-muted-foreground">
                          {totalCustomers > 0 
                            ? `${(((segment.customer_count || 0) / totalCustomers) * 100).toFixed(1)}% of total`
                            : 'customers'
                          }
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/customers?segment=${segment.id}`}>
                              <Users className="mr-2 h-4 w-4" />
                              View Customers
                            </Link>
                          </DropdownMenuItem>
                          {segment.type !== 'system' && (
                            <>
                              <DropdownMenuItem onClick={() => openEditDialog(segment)}>
                                <Edit className="mr-2 h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDuplicate(segment)}>
                                <Copy className="mr-2 h-4 w-4" />
                                Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                className="text-destructive"
                                onClick={() => setDeleteId(segment.id)}
                              >
                                <Trash className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editSegment} onOpenChange={(open) => !open && setEditSegment(null)}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit Segment</DialogTitle>
            <DialogDescription>
              Update segment details and conditions
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Segment Name</Label>
              <Input 
                id="edit-name"
                value={editData.name}
                onChange={(e) => setEditData({ ...editData, name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-description">Description</Label>
              <Input 
                id="edit-description"
                value={editData.description}
                onChange={(e) => setEditData({ ...editData, description: e.target.value })}
              />
            </div>
            
            <div className="space-y-3">
              <Label>Conditions</Label>
              {editConditions.map((condition, index) => (
                <div key={index} className="flex gap-2 items-start">
                  <Select 
                    value={condition.field}
                    onValueChange={(v) => updateEditCondition(index, 'field', v)}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Select field" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="last_service">Last Service Date</SelectItem>
                      <SelectItem value="city">City/Location</SelectItem>
                      <SelectItem value="service_type">Service Type</SelectItem>
                      <SelectItem value="total_spend">Total Spend</SelectItem>
                      <SelectItem value="quote_status">Quote Status</SelectItem>
                      <SelectItem value="next_appointment">Next Appointment</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={condition.operator}
                    onValueChange={(v) => updateEditCondition(index, 'operator', v)}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Operator" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="equals">equals</SelectItem>
                      <SelectItem value="not_equals">not equals</SelectItem>
                      <SelectItem value="greater_than">greater than</SelectItem>
                      <SelectItem value="less_than">less than</SelectItem>
                      <SelectItem value="within">within</SelectItem>
                      <SelectItem value="more_than">more than</SelectItem>
                      <SelectItem value="includes">includes</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input 
                    placeholder="Value" 
                    className="flex-1"
                    value={condition.value}
                    onChange={(e) => updateEditCondition(index, 'value', e.target.value)}
                  />
                  {editConditions.length > 1 && (
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => removeEditCondition(index)}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addEditCondition}>
                <Plus className="mr-2 h-4 w-4" />
                Add Condition
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSegment(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Segment?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The segment will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete} 
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
