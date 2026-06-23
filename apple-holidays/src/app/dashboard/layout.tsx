import Sidebar from '@/components/layout/sidebar'
import OneDriveSyncOnLogin from '@/components/layout/onedrive-sync-on-login'
import { CountryFilterProvider } from '@/hooks/use-country-filter'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <CountryFilterProvider>
      <div className="flex min-h-screen bg-slate-50">
        <Sidebar />
        <main className="ml-[260px] flex-1 min-w-0">
          {children}
        </main>
      </div>
      {/* Fires a background OneDrive scan once per browser session on login */}
      <OneDriveSyncOnLogin />
    </CountryFilterProvider>
  )
}
