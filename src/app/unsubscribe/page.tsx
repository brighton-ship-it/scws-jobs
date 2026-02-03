'use client'

export const dynamic = 'force-dynamic'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'

function UnsubscribeContent() {
  const searchParams = useSearchParams()
  const campaignId = searchParams.get('cid')
  const recipientId = searchParams.get('rid')
  
  const [status, setStatus] = useState<'loading' | 'confirming' | 'success' | 'error'>('confirming')
  const [error, setError] = useState('')

  const handleUnsubscribe = async () => {
    setStatus('loading')
    
    try {
      const response = await fetch('/api/marketing/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          recipientId,
          channel: 'email', // Could be determined from campaign type
        }),
      })

      if (response.ok) {
        setStatus('success')
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to unsubscribe')
        setStatus('error')
      }
    } catch (err) {
      setError('Network error. Please try again.')
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle className="h-6 w-6 text-green-600" />
          </div>
          <CardTitle>Unsubscribed Successfully</CardTitle>
          <CardDescription>
            You've been removed from our marketing emails. You may still receive transactional emails about your service appointments and invoices.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-sm text-muted-foreground">
            Southern California Well Service<br />
            (760) 440-8520
          </p>
        </CardContent>
      </Card>
    )
  }

  if (status === 'error') {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
            <XCircle className="h-6 w-6 text-red-600" />
          </div>
          <CardTitle>Something Went Wrong</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <Button onClick={() => setStatus('confirming')}>
            Try Again
          </Button>
          <p className="text-sm text-muted-foreground">
            Or contact us at (760) 440-8520
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle>Unsubscribe from Marketing Emails</CardTitle>
        <CardDescription>
          Click below to unsubscribe from marketing communications from Southern California Well Service.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-center space-y-4">
        <Button 
          onClick={handleUnsubscribe} 
          disabled={status === 'loading'}
          className="w-full"
        >
          {status === 'loading' ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : (
            'Unsubscribe'
          )}
        </Button>
        <p className="text-xs text-muted-foreground">
          You will still receive important emails about your service appointments and invoices.
        </p>
      </CardContent>
    </Card>
  )
}

function LoadingFallback() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle>Loading...</CardTitle>
      </CardHeader>
      <CardContent className="flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </CardContent>
    </Card>
  )
}

export default function UnsubscribePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Suspense fallback={<LoadingFallback />}>
        <UnsubscribeContent />
      </Suspense>
    </div>
  )
}
