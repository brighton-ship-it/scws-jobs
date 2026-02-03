'use client'

import { useState, useEffect, createContext, useContext } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  Home,
  FileText,
  History,
  Phone,
  Mail,
  Menu,
  X,
  Loader2
} from 'lucide-react'
import { Button } from '@/components/ui/button'

// Portal context for sharing customer data
interface PortalContextType {
  customer: {
    id: string
    name: string
    email: string | null
    phone: string | null
    billing_address: string | null
  } | null
  properties: {
    id: string
    address: string
    city: string | null
  }[]
  isLoading: boolean
  error: string | null
  token: string
}

const PortalContext = createContext<PortalContextType>({
  customer: null,
  properties: [],
  isLoading: true,
  error: null,
  token: '',
})

export const usePortal = () => useContext(PortalContext)

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string
  
  const [customer, setCustomer] = useState<PortalContextType['customer']>(null)
  const [properties, setProperties] = useState<PortalContextType['properties']>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    async function validateToken() {
      try {
        const res = await fetch(`/api/portal/${token}`)
        const data = await res.json()
        
        if (!res.ok) {
          setError(data.error || 'Invalid portal link')
          return
        }
        
        setCustomer(data.customer)
        setProperties(data.properties || [])
      } catch (err) {
        setError('Failed to load portal')
        console.error(err)
      } finally {
        setIsLoading(false)
      }
    }
    
    if (token) {
      validateToken()
    }
  }, [token])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-[#1f3b4d]" />
          <p className="mt-4 text-muted-foreground">Loading your portal...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="bg-red-100 text-red-800 rounded-full p-4 inline-block mb-4">
            <X className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Portal Access Error</h1>
          <p className="text-muted-foreground mb-6">{error}</p>
          <p className="text-sm text-muted-foreground">
            If you believe this is a mistake, please contact us:
          </p>
          <div className="mt-2">
            <a href="tel:+17604408520" className="text-[#1f3b4d] font-medium">
              (760) 440-8520
            </a>
          </div>
        </div>
      </div>
    )
  }

  const navItems = [
    { href: `/portal/${token}`, icon: Home, label: 'Dashboard' },
    { href: `/portal/${token}/invoices`, icon: FileText, label: 'Invoices' },
    { href: `/portal/${token}/history`, icon: History, label: 'Service History' },
  ]

  return (
    <PortalContext.Provider value={{ customer, properties, isLoading, error, token }}>
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-[#1f3b4d] text-white sticky top-0 z-50">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between h-16">
              <div>
                <Link href={`/portal/${token}`}>
                  <h1 className="text-lg font-bold">Southern California Well Service</h1>
                </Link>
                {customer && (
                  <p className="text-white/70 text-sm">Welcome, {customer.name}</p>
                )}
              </div>
              
              {/* Desktop Nav */}
              <nav className="hidden md:flex items-center gap-1">
                {navItems.map((item) => (
                  <Link key={item.href} href={item.href}>
                    <Button variant="ghost" size="sm" className="text-white hover:bg-white/10">
                      <item.icon className="h-4 w-4 mr-2" />
                      {item.label}
                    </Button>
                  </Link>
                ))}
              </nav>
              
              {/* Mobile Menu Button */}
              <Button 
                variant="ghost" 
                size="icon" 
                className="md:hidden text-white hover:bg-white/10"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>
          
          {/* Mobile Nav */}
          {mobileMenuOpen && (
            <nav className="md:hidden border-t border-white/10 pb-4">
              <div className="container mx-auto px-4 space-y-1 pt-2">
                {navItems.map((item) => (
                  <Link key={item.href} href={item.href} onClick={() => setMobileMenuOpen(false)}>
                    <Button variant="ghost" className="w-full justify-start text-white hover:bg-white/10">
                      <item.icon className="h-4 w-4 mr-3" />
                      {item.label}
                    </Button>
                  </Link>
                ))}
              </div>
            </nav>
          )}
        </header>

        {/* Main Content */}
        <main className="container mx-auto px-4 py-6 max-w-4xl">
          {children}
        </main>

        {/* Footer */}
        <footer className="bg-white border-t mt-auto py-6">
          <div className="container mx-auto px-4 max-w-4xl">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
              <p>© {new Date().getFullYear()} Southern California Well Service</p>
              <div className="flex items-center gap-4">
                <a href="tel:+17604408520" className="flex items-center gap-1 hover:text-[#1f3b4d]">
                  <Phone className="h-4 w-4" />
                  (760) 440-8520
                </a>
                <a href="mailto:info@scwellservice.com" className="flex items-center gap-1 hover:text-[#1f3b4d]">
                  <Mail className="h-4 w-4" />
                  info@scwellservice.com
                </a>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </PortalContext.Provider>
  )
}
