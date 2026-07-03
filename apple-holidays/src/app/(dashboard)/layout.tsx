import DashboardShell from '@/components/layout/dashboard-shell'
import { SidebarProvider } from '@/hooks/use-sidebar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <DashboardShell>
        {children}
      </DashboardShell>
    </SidebarProvider>
  )
}
