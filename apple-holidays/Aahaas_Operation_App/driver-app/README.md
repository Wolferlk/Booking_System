# Aahaas — iOS & Android ops app (Expo / React Native)

One app with the Aahaas brand and **two logins** on the welcome screen — **Driver** and **Company**:

- **Drivers.** Any driver who is already in `drivers` (from https://ops.aahaas.com/register/driver) can sign in. The first time, they verify the phone number or e-mail from that form with a 6-digit code (WhatsApp or e-mail) and choose a password. They never register twice.
- **Company.** Every ops.aahaas.com staff role (BT, GT, GT-VN, TE, GT/TE, AC, RS, Super Admin, Ultra Super Admin) signs in with the same e-mail and password as the web. Ultra Super Admin also needs the critical password, the same as on the web.

The app uses the existing ops backend at `/api/mobile/*` (code in `apple-holidays/src/lib/mobile/`). Ops manage it on the web at **Driver App** (`/dashboard/driver-app`).

## What a driver does

| Screen | What it does |
|---|---|
| **Today** | Greeting, the trip for today, and **one** swipe button for the next step: start trip → start day → (live km + timer) → end day → finish trip. Below it: today's plan with **Navigate** buttons, tonight's hotel and flights, and an AI **"Read my day"** card that reads the plan aloud in English, Sinhala, Tamil or Vietnamese. |
| **Start trip** | Shows the guest their **trip-portal QR**, which they can skip, then a swipe to start. |
| **Start day** | Asks for location and starts GPS. Kilometres are counted on the server with GPS jitter and jumps filtered out. Points wait in a queue on the phone while there's no signal. |
| **Finish trip** | Shows the guest the **feedback QR** and checks every 5 seconds. The finish swipe only unlocks once the guest has sent the form, or ops has waived it ("Guest will not rate?"). |
| **My trips** | Upcoming and finished trips, with each day's plan and km per day. |
| **Get trips** | The Driver-Auto open-trip board. Request a trip, or withdraw a request (same rules as the WhatsApp board). |
| **Score** | Score ring and grade, star rating, km, tours, praise and complaints, guest comments, km per month, and badges. These are the same numbers as Drivers & Vehicles → Performance. Rates and agent names are never shown. |
| **Me** | Vehicle, details, language and requests. Changing the phone, e-mail, licence, photo or bank details sends a request to ops, and nothing changes until a person approves it. |
| **Vehicle photos** | Due every **60 days**: front, back and inside are required; sides and odometer are optional. An AI first look (gpt-4o-mini) flags blurry or wrong photos, visible damage and plate mismatches. Ops approve or ask for a retake. |
| **Help (red button)** | Call ops in one tap, or send *vehicle problem / accident / guest / route* with GPS. This pushes to every ops phone at once. |
| **Can't continue** | Asks ops for a driver change (Sri Lanka runs one driver per round trip). Ops pick the new driver in SL Driver Allocation as usual, then approve. |

**Notifications** (push and the in-app bell, sent hourly by `/api/cron/mobile-notify`):

- A new trip was assigned.
- The evening before a trip.
- The morning of each driving day.
- Vehicle photos are due.
- Ops answered a request.

**Company app:**

| Tab | What it does |
|---|---|
| **Home** | Today in one screen: on tour now, arriving / leaving today, WhatsApp unread, drivers driving, driver requests, and shortcuts to the MC Report, WhatsApp, team chat and the live map. |
| **Bookings** | Every booking, with search by ref, IS number, guest or agent, plus quick views: on tour, arriving today / tomorrow / upcoming, leaving today, new today. |
| **Booking page** | The status buttons your role has on the web (same state machine), the operation checklist, guests, contact, flights, hotels, special notes, agenda with drivers per movement, a per-movement **WhatsApp brief** to driver / guide / vendor, tickets with files, P&L (revenue, cost, profit, lines), and the timeline. Tools: **PDF** and **Agenda Word** (open or share), **portal link** (copy or share), **send the Tour Confirmation on WhatsApp**, guest chat, agent e-mail, feedback and complete, and **cancel request** (with the same e-mailed code as the web). |
| **Chats** | The **WhatsApp inbox** (threads, booking link, 24h-window banner, send, media) and the **team chat** (conversations, unread, live polling, send, attachments). |
| **Drivers** | The driver and vehicle registry with search. Each driver page has the score ring, rating, tours, vehicle photos, details, WhatsApp history and send, and call. |
| **More** | **MC Report** (a day or a week; *needs driver* / airport / allocated views; tap a row to open the booking), live drivers, driver requests and sign out. |

**How the company app reaches the web's features.** It does not copy any of them. It calls the web's own `/api/*` routes through **`/api/mobile/web/*`** (`src/lib/mobile/bridge.ts`):

1. It checks the app token.
2. It allows only the listed areas: bookings, tickets, mc-report, whatsapp, chat, ground, driver-auto, srilanka, feedbacks, PDF and verification.
3. It runs the call as that person, using a 5-minute web session.
4. It writes an **ActivityLog** row (`MOBILE_POST/PUT/PATCH`) for every change.

So the app can never do more than the same person can on the web. These stay **web-only** on purpose:

- deleting a booking
- full cancellation
- restoring a version
- bulk changes
- deleting drivers, vehicles or vendors
- saving the movement chart, which rewrites every movement

**Ops (driver operations) in the app:**

- **Live:** a map of drivers on the road, km today, drivers with no GPS for 20+ minutes, drivers who haven't started yet, and each driver's route for the day.
- **Requests:** approve or decline driver requests and vehicle photos.

## Test it on your iPhone 14 Pro (from this Mac)

```bash
cd apple-holidays/Aahaas_Operation_App/driver-app
npm install            # first time only
npx expo start         # then scan the QR with the iPhone Camera → opens in Expo Go
```

1. Install **Expo Go** from the App Store. The iPhone and the Mac must be on the same Wi-Fi; otherwise run `npx expo start --tunnel`.
2. By default the app talks to **https://ops.aahaas.com**. Before that works, the server has to be deployed and the tables created (see below).
3. **Expo Go limits:** background GPS doesn't run in Expo Go. The app falls back to counting km while it is open on screen, and tells the driver so. Push notifications need a real build; the in-app bell works.

**A real build on the iPhone, with background GPS and push.** You need an Apple Developer account ($99/yr):

```bash
npx eas-cli@latest login
npx eas-cli@latest init                  # adds the projectId that push needs
npx eas-cli@latest build --profile development --platform ios
```

Install the build from the link, then run `npx expo start --dev-client`. For Android: `--platform android --profile preview` gives you an APK.

To point the app at another server:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 npx expo start
```

⚠ The local `.env` in `apple-holidays/` builds its DB URL from `DB_*`, and those point at the **live** database. A local `npm run dev` therefore reads and writes live data.

## Going live — server side (in order)

1. **Create the tables.** This is additive only: nine `CREATE TABLE IF NOT EXISTS mobile_*`, no ALTER, DROP or UPDATE.
   ```bash
   cd apple-holidays
   bash prisma/sql/apply-driver-app.sh --check   # shows the target DB, runs nothing
   bash prisma/sql/apply-driver-app.sh           # asks before running
   ```
   Never `prisma db push` on live.
2. **Deploy** the web app. It includes the new `/api/mobile/*` and `/api/driver-app/*` routes, the Driver App page, the sidebar link, and the middleware exclusion for `/api/mobile`. Until step 1 is done, those routes answer "not switched on yet" and touch nothing else.
3. **Register the WhatsApp code template.** On the Driver App page, an admin clicks **WhatsApp code template**. It is an AUTHENTICATION template with a copy-code button, and Meta must approve it. Until then, codes go by e-mail, or by WhatsApp only to drivers who messaged the ops number in the last 24 hours.
4. **Call the cron hourly:** `GET /api/cron/mobile-notify` with `Authorization: Bearer $CRON_SECRET`. It is already in `vercel.json`; on Amplify, add it wherever the other crons are triggered.
5. Optional env vars:
   - `MOBILE_JWT_SECRET`: defaults to a value derived from `NEXTAUTH_SECRET`.
   - `EXPO_ACCESS_TOKEN`: only needed if push security is enabled on EAS.
   - `MOBILE_AI_VISION_MODEL` and `MOBILE_AI_TEXT_MODEL`: both default to `gpt-4o-mini`.

## Live-database safety

- **Company app:** each change goes through the same web route the website uses, with the same permission checks. Every change is also logged to `activity_logs` with `via: aahaas-app`. Irreversible actions are blocked in the bridge (see the list above). The bridge calls the server's own public address (`NEXTAUTH_URL`); set `MOBILE_BRIDGE_ORIGIN` if that address is not reachable from the server itself.

- The app **writes only to the new `mobile_*` tables**. Everything else it reads.
- An existing table is written only when **a person in ops approves** something, and only the named fields of that one row change:
  - A profile change updates that driver's row in `drivers`.
  - Approved vehicle photos update `vehicles.photoOutside` and `vehicles.photoInside`.
  - Trip requests go through the existing Driver-Auto code unchanged.
- Rates (`driverRate`), agent names and guest contact details are never sent to the app.
