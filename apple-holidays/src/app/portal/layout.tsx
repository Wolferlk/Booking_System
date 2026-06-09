import Sidebar from '@/components/layout/sidebar'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-950">
      <Sidebar />
      <main className="ml-[260px] flex-1 min-w-0">
        {children}
      </main>
    </div>
  )
}
