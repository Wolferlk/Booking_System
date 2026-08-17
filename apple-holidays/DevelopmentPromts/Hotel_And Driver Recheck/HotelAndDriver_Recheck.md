# Automated Hotel Re-Checking – Auto Call Module

## 1. Objective

Develop an **Automated Hotel Re-Checking Call System** to contact hotels and reconfirm all important reservation details before the guest's arrival.

The system must perform hotel re-checking at two stages:

* **D-10** — 10 days before the hotel check-in date
* **D-1** — 1 day before the hotel check-in date

The purpose is to identify any reservation issues before the guest arrives and ensure that the hotel has the correct booking information.
![
    
](image.png)
---

## 2. Re-Checking Schedule

```text
Hotel Booking Confirmed
        │
        ▼
   Monitor Check-in Date
        │
        ├──────────────► D-10 Re-Check
        │                 │
        │                 ▼
        │           Automated Hotel Call
        │                 │
        │                 ▼
        │          Save Call Results
        │
        ▼
   Continue Monitoring
        │
        ▼
     D-1 Re-Check
        │
        ▼
 Automated Hotel Call
        │
        ▼
 Final Confirmation
        │
        ▼
 Guest Check-in
```

---

# 3. Details to Check with the Hotel

During both the **D-10** and **D-1** calls, the automated calling system must verify the following information with the hotel.

### A. Reservation Confirmation

* [ ] Is the reservation confirmed?
* [ ] Hotel confirmation number
* [ ] Booking/reference number
* [ ] Guest name
* [ ] Lead guest name
* [ ] Check-in date
* [ ] Check-out date
* [ ] Number of nights

### B. Room Details

* [ ] Room type
* [ ] Room category
* [ ] Number of rooms
* [ ] Bed type (Double / Twin / Triple, etc.)
* [ ] Extra bed, if applicable
* [ ] Child With Bed (CWB), if applicable
* [ ] Child No Bed (CNB), if applicable

### C. Guest / Pax Details

* [ ] Number of adults
* [ ] Number of children
* [ ] Number of infants
* [ ] Total number of guests

### D. Meal Plan

* [ ] Confirm the booked meal plan
* [ ] Breakfast included
* [ ] Half Board, if applicable
* [ ] Full Board, if applicable
* [ ] Any other meal arrangements

### E. Special Requests

* [ ] Early check-in request
* [ ] Late check-out request
* [ ] Honeymoon arrangement
* [ ] Birthday / anniversary arrangement
* [ ] Connecting rooms
* [ ] Adjacent rooms
* [ ] Extra bed
* [ ] Baby cot
* [ ] Accessibility requirements
* [ ] Any other special requests mentioned in the booking

### F. Payment Status

* [ ] Has the hotel received the payment?
* [ ] Is the booking fully paid?
* [ ] Is there any outstanding payment?
* [ ] Is a payment required before check-in?
* [ ] Is the hotel expecting the guest to make any payment directly?

### G. Voucher Verification

* [ ] Has the hotel received the booking voucher?
* [ ] Does the voucher match the hotel's reservation?
* [ ] Are there any differences between the voucher and the hotel's system?

### H. Final Hotel Confirmation

At the end of the call, the system should ask the hotel to confirm:

> **"Can you confirm that this reservation is fully confirmed and that there will be no issue when the guest arrives for check-in?"**

---

# 4. D-10 Re-Checking Process

```text
Check-in Date - 10 Days
        │
        ▼
Retrieve Booking Details
        │
        ▼
Retrieve Hotel Contact Number
        │
        ▼
Start Automated AI Call
        │
        ▼
Verify Reservation Details
        │
        ├── Everything Correct ──► Mark "D-10 Confirmed"
        │
        └── Issue Found ─────────► Mark "Action Required"
                                      │
                                      ▼
                              Notify Reservation Team
```

The **D-10 check** is the first complete verification of the booking. It provides enough time for the reservation team to correct room, payment, voucher, guest, or other booking issues.

---

# 5. D-1 Final Re-Checking Process

```text
Check-in Date - 1 Day
        │
        ▼
Check Previous D-10 Result
        │
        ▼
Start Final Automated Call
        │
        ▼
Reconfirm Critical Details
        │
        ├── Confirmed ─────► D-1 Final Confirmed
        │
        └── Issue Found ───► URGENT ACTION REQUIRED
                                   │
                                   ▼
                          Notify Reservation Team
                                   │
                                   ▼
                           Resolve Before Arrival
```

The **D-1 check** is the final verification before the guest arrives. Any problem identified at this stage should be treated as **urgent**.

---

# 6. Overall Auto-Call Flow

```text
                     HOTEL BOOKING
                          │
                          ▼
                 Booking Confirmed
                          │
                          ▼
                Monitor Check-in Date
                          │
              ┌───────────┴───────────┐
              │                       │
            D-10                     D-1
              │                       │
              ▼                       ▼
        Auto AI Call            Auto AI Call
              │                       │
              ▼                       ▼
       Verify Full Booking      Final Re-Check
              │                       │
        ┌─────┴─────┐           ┌─────┴─────┐
        │           │           │           │
     Correct      Issue      Confirmed     Issue
        │           │           │           │
        ▼           ▼           ▼           ▼
   D-10 Confirmed  Action    D-1 Final    URGENT
                   Required   Confirmed    Action
        │           │           │           │
        └───────────┴───────────┴───────────┘
                          │
                          ▼
                  Save Call History
                          │
                          ▼
                 Reservation Record
```

## 7. Information to Save After Every Call

The system should save:

* Call date and time
* Re-check type: **D-10 / D-1**
* Hotel name
* Hotel contact number
* Booking reference
* Call status
* Call duration
* Hotel representative's name, if available
* Reservation confirmation status
* Hotel confirmation number
* Verified booking details
* Issues identified
* Required actions
* Call transcript
* AI-generated call summary
* Call recording reference, if recording is enabled
* Final result: **Confirmed / Issue Found / No Answer / Call Failed / Follow-up Required**
