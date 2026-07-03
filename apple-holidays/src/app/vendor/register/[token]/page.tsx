'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

// Legacy per-vendor registration links now redirect to the universal registration page
export default function VendorRegisterTokenPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/vendor/register') }, [router])
  return (
    <div className="min-h-screen bg-[#060a14] flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
    </div>
  )
}
