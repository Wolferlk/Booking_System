import DashboardShell from '@/components/layout/dashboard-shell'
import OneDriveSyncOnLogin from '@/components/layout/onedrive-sync-on-login'
import { CountryFilterProvider } from '@/hooks/use-country-filter'
import { SidebarProvider } from '@/hooks/use-sidebar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <CountryFilterProvider>
        <DashboardShell>
          {children}
        </DashboardShell>
        <OneDriveSyncOnLogin />
      </CountryFilterProvider>
    </SidebarProvider>
  )
}
