'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function MalaysiaPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/singapore') }, [router])
  return null
}
