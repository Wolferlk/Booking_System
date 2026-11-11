'use client'

import Link from 'next/link'
import { ArrowLeft, Store } from 'lucide-react'
import Header from '@/components/layout/header'
import VendorRegister from '@/components/vn-vendor-sync/vendor-register'

export default function VendorRegisterPage() { return <><Header title="VN Vendor Register" subtitle="Keep one reliable contact number for every vendor named in the Vietnam Excel checklist" /><main className="space-y-5 px-4 py-5 sm:px-8 sm:py-6"><Link href="/dashboard/checklist-vn/vendor-sync" className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:underline"><ArrowLeft className="h-3.5 w-3.5" />Back to VN Vendor Sync</Link><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700"><Store className="h-5 w-5" /></span><div><h1 className="text-lg font-bold text-slate-800">Vendor contact register</h1><p className="text-xs text-slate-500">The Excel stores the name; this register stores the number shown to guests.</p></div></div><VendorRegister /></main></> }
