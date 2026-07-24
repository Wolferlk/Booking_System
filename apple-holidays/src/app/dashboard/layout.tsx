import DashboardShell from '@/components/layout/dashboard-shell'
import OneDriveSyncOnLogin from '@/components/layout/onedrive-sync-on-login'
import WelcomeSplash from '@/components/layout/welcome-splash'
import OpsAI from '@/components/ops-ai/ops-ai'
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
        <WelcomeSplash />
        {/* OPS_AI copilot — floats above every dashboard route, including the
            full-screen ones, so it is always one keystroke (⌘J) away. */}
        <OpsAI />
      </CountryFilterProvider>
    </SidebarProvider>
  )
}
