import DashboardShell from '@/components/layout/dashboard-shell'
import OneDriveSyncOnLogin from '@/components/layout/onedrive-sync-on-login'
import WelcomeSplash from '@/components/layout/welcome-splash'
import AsImportAlert from '@/components/layout/as-import-alert'
import OpsAI from '@/components/ops-ai/ops-ai'
import OpsAiTour from '@/components/ops-ai/ops-ai-tour'
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
        {/* Surfaces a failed AppleSystem confirmations import to the first staff
            member who signs in after it, so a missed morning run is caught the
            same day rather than whenever someone checks the run history. */}
        <AsImportAlert />
        {/* OPS_AI copilot — floats above every dashboard route, including the
            full-screen ones, so it is always one keystroke (⌘J) away. */}
        <OpsAI />
        {/* Launch guide for OPS_AI — greets staff once a day for the first two
            weeks, then stays replayable from inside the panel. */}
        <OpsAiTour />
      </CountryFilterProvider>
    </SidebarProvider>
  )
}
