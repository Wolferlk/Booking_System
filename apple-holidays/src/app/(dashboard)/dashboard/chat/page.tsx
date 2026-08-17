'use client'

/**
 * /dashboard/chat — the full messenger.
 *
 * Shares its tables with the Accounts system, so the people list here reaches
 * the finance desk as readily as the desk next door, and a P&L shared from there
 * opens inside this page.
 */

import { Suspense } from 'react'
import Header from '@/components/layout/header'
import { ChatPage } from '@/components/chat/chat-page'

export default function ChatRoute() {
  return (
    <>
      <Header
        title="Chat"
        subtitle="Message anyone in Operations or Accounts — and share bookings, agendas, invoices and P&L they can open in place"
      />
      {/* useSearchParams needs a Suspense boundary in the app router. */}
      <Suspense fallback={null}>
        <ChatPage />
      </Suspense>
    </>
  )
}
