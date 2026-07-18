# New Booking Insert — JSON Format

Source: `Apple Holidays APIs Live.postman_collection.json` → **Booking → Book** request.

## Endpoint

```
POST {{api_url}}/api/booking/save
Content-Type: application/json
Authorization: Bearer {{token}}
```

> Auth token is obtained from `POST /api/auth/login` (email + password) — remember to add the Bearer token to every request other than login.

---

## Request Body — Structure

```jsonc
{
  "config": {
    "status":        1,            // 1 = not confirmed (draft), 2 = confirmed
    "tour_session":  1213564785,   // unique tour session id
    "tour_type":     3,            // tour type id
    "quotation_no":  370442        // quotation reference number
  },
  "country_data": {
    "country": 62                  // country id
  },
  "genaral_data": {                // NOTE: API spells it "genaral_data"
    "arrival_date": "30/12/2025",  // DD/MM/YYYY
    "pax": {
      "adult": 2,                  // number of adults
      "cwb":   0,                  // children WITH bed
      "cnb":   0                   // children NO bed
    },
    "market": 1                    // market id
  },
  "destination_data": {
    "place":                  [1, 10, 13, 2, 1],   // ordered place ids of the itinerary
    "place_pretend_type":     [2, 1, 1, 1, 3],     // per-place type flag
    "transport_availability": [1, 0, 1, 1]         // per-leg transport on(1)/off(0)
  },
  "accommodation_data": {
    "accommodation": [1, 2, 1],    // accommodation flags aligned to hotels
    "hotel": [
      {
        "hotel":                551,           // hotel id (0 = no hotel / transit)
        "place":                10,            // place id this stay belongs to
        "check_in":             "30/12/2019",  // DD/MM/YYYY
        "check_out":            "31/12/2019",  // DD/MM/YYYY
        "nights":               1,
        "provider":             "local",       // "local" or provider name
        "room_category":        9,             // room category id
        "meal_type":            1,             // meal plan id
        "room_type": [
          { "id": 2, "count": 1 }             // room type id + how many rooms
        ],
        "extrabed":             0,
        "driver_accommodation": 0
      },
      {
        "hotel":                0,             // 0 = no hotel (transport-only leg)
        "place":                13,
        "check_in":             "31/12/2019",
        "check_out":            "01/01/2020",
        "nights":               1,
        "provider":             "local",
        "extrabed":             0,
        "transportation":       1,             // transport-only leg flag
        "driver_accommodation": 0
      }
    ]
  },
  "tours_data": [
    {
      "id":      288,               // tour / activity id
      "day":     2,                 // itinerary day number
      "time_id": 50,                // time slot id (optional for some types)
      "pax": { "adult": 1, "cwb": 1, "cnb": 0 },
      "type":    "attraction"       // attraction | city_tour | excursion
    }
  ],
  "markup_data": {
    "markup_amount":       "10",    // adult markup value
    "markup_type":         "1",     // 1 = percentage, 2 = fixed (per system config)
    "markup_amount_child": "10",    // child markup value
    "markup_type_child":   "1",
    "save_type":           "save"   // "save" (draft) or final save action
  }
}
```

### Notes
- `place`, `place_pretend_type` and `transport_availability` are **parallel arrays** — index positions must line up with the itinerary order.
- `accommodation_data.accommodation` array aligns with the `hotel` array order.
- A `hotel` entry with `"hotel": 0` + `"transportation": 1` represents a transport-only leg (no accommodation for that night).
- `tours_data[].type` accepts `attraction`, `city_tour`, and `excursion`. `time_id` is used for time-slotted tours (attractions); `city_tour` / `excursion` may omit it.
- Dates are all `DD/MM/YYYY`.

---

## Sample Input Data (ready to POST)

```json
{
  "config": {
    "status": 1,
    "tour_session": 1213564785,
    "tour_type": 3,
    "quotation_no": 370442
  },
  "country_data": {
    "country": 62
  },
  "genaral_data": {
    "arrival_date": "30/12/2025",
    "pax": {
      "adult": 2,
      "cwb": 0,
      "cnb": 0
    },
    "market": 1
  },
  "destination_data": {
    "place": [1, 10, 13, 2, 1],
    "place_pretend_type": [2, 1, 1, 1, 3],
    "transport_availability": [1, 0, 1, 1]
  },
  "accommodation_data": {
    "accommodation": [1, 2, 1],
    "hotel": [
      {
        "hotel": 551,
        "place": 10,
        "check_in": "30/12/2025",
        "check_out": "31/12/2025",
        "nights": 1,
        "provider": "local",
        "room_category": 9,
        "meal_type": 1,
        "room_type": [
          { "id": 2, "count": 1 }
        ],
        "extrabed": 0,
        "driver_accommodation": 0
      },
      {
        "hotel": 0,
        "place": 13,
        "check_in": "31/12/2025",
        "check_out": "01/01/2026",
        "nights": 1,
        "provider": "local",
        "extrabed": 0,
        "transportation": 1,
        "driver_accommodation": 0
      },
      {
        "hotel": 1535,
        "place": 2,
        "check_in": "01/01/2026",
        "check_out": "02/01/2026",
        "nights": 1,
        "provider": "local",
        "room_category": 10,
        "meal_type": 1,
        "room_type": [
          { "id": 2, "count": 1 }
        ],
        "extrabed": 0,
        "driver_accommodation": 0
      }
    ]
  },
  "tours_data": [
    {
      "id": 288,
      "day": 2,
      "time_id": 50,
      "pax": { "adult": 1, "cwb": 1, "cnb": 0 },
      "type": "attraction"
    },
    {
      "id": 279,
      "day": 3,
      "time_id": 51,
      "pax": { "adult": 2, "cwb": 1, "cnb": 0 },
      "type": "attraction"
    },
    {
      "id": 56,
      "day": 3,
      "pax": { "adult": 3, "cwb": 1, "cnb": 0 },
      "type": "city_tour"
    },
    {
      "id": 103,
      "day": 1,
      "pax": { "adult": 4, "cwb": 1, "cnb": 0 },
      "type": "excursion"
    }
  ],
  "markup_data": {
    "markup_amount": "10",
    "markup_type": "1",
    "markup_amount_child": "10",
    "markup_type_child": "1",
    "save_type": "save"
  }
}
```

---

## Field Quick Reference

| Section | Field | Meaning |
|---|---|---|
| `config` | `status` | 1 = not confirmed (draft), 2 = confirmed |
| `config` | `tour_session` | Unique tour session id |
| `config` | `tour_type` | Tour type id |
| `config` | `quotation_no` | Quotation reference number |
| `country_data` | `country` | Country id |
| `genaral_data` | `arrival_date` | Arrival date, `DD/MM/YYYY` |
| `genaral_data` | `pax.adult / cwb / cnb` | Adults / children with bed / children no bed |
| `genaral_data` | `market` | Market id |
| `destination_data` | `place[]` | Ordered itinerary place ids |
| `destination_data` | `place_pretend_type[]` | Per-place type flag (parallel to `place`) |
| `destination_data` | `transport_availability[]` | Per-leg transport on(1)/off(0) |
| `accommodation_data` | `accommodation[]` | Accommodation flags (aligned to `hotel[]`) |
| `accommodation_data.hotel[]` | `hotel` | Hotel id (0 = transport-only / no hotel) |
| `accommodation_data.hotel[]` | `room_type[]` | `{ id, count }` room type + room count |
| `accommodation_data.hotel[]` | `meal_type` | Meal plan id |
| `tours_data[]` | `type` | `attraction` / `city_tour` / `excursion` |
| `tours_data[]` | `time_id` | Time slot id (for slotted tours) |
| `markup_data` | `markup_type` | 1 = percentage, 2 = fixed |
| `markup_data` | `save_type` | `save` (draft) or final save |
