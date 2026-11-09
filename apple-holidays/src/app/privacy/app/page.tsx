/**
 * Public privacy policy for the Aahaas CORE mobile app (driver, vehicle vendor
 * and company logins). Linked from the app (Me / Account / More / waiting
 * screen / Delete account) and entered as the Privacy Policy URL in App Store
 * Connect and Google Play. Not covered by the auth middleware — keep it public.
 *
 * Keep it true: when the app starts collecting something new, add it here and
 * update the App Store "App Privacy" answers in the same change.
 */
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy · Aahaas CORE app',
  description: 'What the Aahaas CORE app collects, why, who it is shared with, and how to delete your account.',
}

/** Change these two if the contact details change. */
const CONTACT_EMAIL = 'ops@aahaas.com'
const CONTACT_PHONE = '+94 70 722 4229'
const UPDATED = '9 November 2026'

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-bold text-slate-900 mt-8 mb-2">{children}</h2>
}

export default function AppPrivacyPolicy() {
  return (
    <main className="min-h-screen bg-white text-slate-700">
      <div className="mx-auto max-w-2xl px-4 py-10 leading-relaxed text-[15px]">
        <p className="text-xs font-semibold uppercase tracking-widest text-rose-600">Aahaas CORE</p>
        <h1 className="text-3xl font-black text-slate-900 mt-1">Privacy Policy</h1>
        <p className="text-sm text-slate-500 mt-1">Last updated {UPDATED}</p>

        <p className="mt-6">
          Aahaas CORE is the operations app of Aahaas (Apple Holidays). It is used by the drivers and vehicle
          vendors who carry our guests, and by our own operations staff. This policy explains what the app
          collects, why, who we share it with, and how you can delete your account. We do not sell personal
          data and we do not use it for advertising.
        </p>

        <H>What we collect</H>
        <ul className="list-disc pl-5 space-y-2">
          <li><b>Account details</b> — your name, WhatsApp/phone number, e-mail, the country you work in and
            a password (stored only as a one-way hash). Drivers also give a driving licence number and may add a
            profile photo. Vendors give a company name and address.</li>
          <li><b>Payment details</b> — bank name, branch, account holder and account number, so we can pay you
            for trips.</li>
          <li><b>Vehicle details and photos</b> — type, plate number, brand, seats, and the vehicle photos you
            take for the regular vehicle check.</li>
          <li><b>Precise location (drivers only)</b> — only between <i>Start day</i> and <i>End day</i> on a
            trip you are driving. We use it to count the kilometres driven and to show our operations team where
            the vehicle is, so they can help guests and you. If you allow &ldquo;Always&rdquo;, tracking keeps
            running while the phone is locked or another app (such as Maps) is open — but still only between
            Start day and End day. Outside a running trip day the app does not collect your location.</li>
          <li><b>Trip records</b> — trips started and finished, pauses, odometer readings, tickets and files
            you upload for a trip, guest feedback status, and requests you send to operations.</li>
          <li><b>Device information</b> — a push-notification token, the phone platform (iOS/Android) and the
            app version, so we can send trip alerts and support you.</li>
          <li><b>Company staff</b> sign in with their existing Aahaas work account; the app shows the same
            booking and guest information they already see on our web system.</li>
        </ul>

        <H>Why we use it</H>
        <ul className="list-disc pl-5 space-y-1">
          <li>To give you trips and show you each day&rsquo;s plan.</li>
          <li>To calculate kilometres and pay you correctly.</li>
          <li>To keep guests safe and help you when something goes wrong on the road.</li>
          <li>To check vehicles meet our standards.</li>
          <li>To sign you in securely (one-time codes) and send trip notifications.</li>
        </ul>

        <H>Who we share it with</H>
        <p>Only with service providers that run parts of the app for us, and only what each one needs:</p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li><b>Amazon Web Services</b> — hosting and storage of our system and uploaded photos.</li>
          <li><b>Meta (WhatsApp Business)</b> — sending sign-in codes and trip messages to your number.</li>
          <li><b>Microsoft</b> — sending e-mails from our mailbox.</li>
          <li><b>Expo, Apple and Google</b> — delivering push notifications.</li>
          <li><b>OpenAI</b> — a first automatic look at vehicle-check photos and a short summary of your day&rsquo;s
            plan. A person in our team always makes the final decision on a vehicle check.</li>
          <li><b>Google Maps</b> (Android) — drawing the route on a map.</li>
        </ul>
        <p className="mt-2">
          Guests on a trip you drive may be given your name, phone number and vehicle so they can find you.
          They never see your bank details. We may disclose data if the law requires it.
        </p>

        <H>How long we keep it</H>
        <p>
          We keep your account details while you work with us. Trip, kilometre and payment records are business
          and tax records, so we keep them for as long as the law requires, even after your account is deleted —
          but without your name and contact details attached.
        </p>

        <H>Deleting your account</H>
        <p>You can delete your account inside the app at any time:</p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li><b>Drivers:</b> Me → <i>Delete my account</i>.</li>
          <li><b>Vehicle vendors:</b> Account → <i>Delete my account</i>.</li>
          <li><b>Waiting for approval:</b> on the waiting screen, tap <i>Delete my registration</i> — your details
            are deleted straight away.</li>
        </ul>
        <p className="mt-2">
          Your login is deleted immediately and you are signed out on every phone. Within 30 days we erase your
          name, phone, e-mail, licence, photo and bank details. Money still owed to you is paid as normal.
          Company staff accounts are closed by an Aahaas administrator. You can also ask us to delete your
          account by e-mail or phone (below).
        </p>

        <H>Your choices</H>
        <ul className="list-disc pl-5 space-y-1">
          <li>You can turn off location, camera, photos and notifications in your phone&rsquo;s settings. Without
            location the app cannot count kilometres for a trip day.</li>
          <li>You can ask us for a copy of your data or to correct it. Profile changes can also be sent from the
            app (Me → Change).</li>
        </ul>

        <H>Security</H>
        <p>
          Data travels over encrypted connections (HTTPS). Passwords are stored only as hashes and sign-in tokens
          are kept in the phone&rsquo;s secure storage.
        </p>

        <H>Children</H>
        <p>The app is for working adults only and is not meant for anyone under 18.</p>

        <H>Changes</H>
        <p>If this policy changes, we will update the date at the top and tell you in the app when the change matters.</p>

        <H>Contact</H>
        <p>
          Aahaas Operations ·{' '}
          <a className="text-rose-600 underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> ·{' '}
          <a className="text-rose-600 underline" href={`tel:${CONTACT_PHONE.replace(/\s/g, '')}`}>{CONTACT_PHONE}</a>
        </p>
      </div>
    </main>
  )
}
