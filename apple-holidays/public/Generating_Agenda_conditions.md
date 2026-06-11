# Movement Chart Generation Rules — AppleHolidays MMT Vietnam

---

## 1. Airport Transfers

### Arrival
- International flight: meetingTime = flight arrTime + 45 minutes  
  Example: flight arrives 14:20 → meetingTime = "15:05"
- Domestic flight: meetingTime = flight arrTime + 30 minutes  
  Example: flight arrives 10:00 → meetingTime = "10:30"
- serviceType = PVT_TRANSFER (private) or SIC_TRANSFER (shared) depending on booking type

### Departure
- meetingTime = flight depTime − 3 hours  
  Example: flight departs 09:30 → meetingTime = "06:30"
- fromPoint = hotel name

---

## 2. Meeting Time Defaults by Tour Type

When exact time is not given in the document, apply these defaults:

| Tour type                  | Default meetingTime |
|----------------------------|---------------------|
| Full-day tour (SIC)        | 07:30               |
| Half-day morning (SIC)     | 08:00               |
| Half-day afternoon (SIC)   | 13:00               |
| Night show / evening tour  | 18:30               |
| Cruise embarkation         | 07:30               |
| Private full-day tour      | 08:00               |
| Private half-day morning   | 08:30               |
| City transfer (PVT)        | Use departure time from itinerary or 08:00 |
| Overnight train / sleeper  | Set to train departure time from itinerary |

**IMPORTANT:** meetingTime must ALWAYS be filled (HH:MM format). Never leave it null or empty except for "Ticket Only" items (see rule 3).

---

## 3. Ticket-Only Items

If the activity is entrance tickets, passes, or own-arrangement activities (no guide, no transfer):
- mealPlan = null (leave blank)
- meetingTime = null (leave blank)
- serviceType = OWN_ARRANGEMENT

---

## 4. Meal Plan

- Only set mealPlan if meals are explicitly included in the package for that day.
- Use: B = Breakfast, L = Lunch, D = Dinner, BL, BD, LD, BLD as applicable.
- If meals not included → leave mealPlan blank/null.

---

## 5. Service Type Selection

- Private vehicle booked → PVT_TRANSFER
- Shared/group transport → SIC_TRANSFER
- Own arrangement, tickets only, free time → OWN_ARRANGEMENT
- Cruises → PVT_TRANSFER (unless explicitly shared)

---

## 6. General Rules

- Generate one item per significant activity or transfer each day.
- Always include arrival day transfer and departure day transfer.
- Split multi-city days into separate items (e.g. "Hanoi to Halong" is separate from "Halong Cruise").
- fromPoint = exact hotel name or airport code.
- toPoint = destination name, hotel name, pier, attraction name.
- details = include timing, vehicle type, specific instructions (e.g. "SIC pickup 07:30 from hotel lobby").
