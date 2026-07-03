# Booking Module Enhancement Prompt

## Context

Improve the Manual Booking Creation page:

`http://localhost:3000/dashboard/bookings/new`

The system currently extracts booking data from Travel Confirmation emails and manually entered booking information. Data accuracy is critical because extracted information is saved directly into the database.

---

# 1. Booking Reference Generation (CRITICAL)

When creating a booking, the Booking Reference must be generated ONLY from the extracted IS Number.

### Allowed Formats

Examples:

* VN45345
* VN42342
* IS2313
* IS4323
* SG53234
* SG43232
* MY43232
* MY56789

### Rules

* DO NOT generate random booking reference numbers.
* DO NOT use timestamps.
* DO NOT use MongoDB IDs.
* DO NOT use sequence numbers.
* Booking Reference = Extracted IS Number.
* If IS Number = `VN45345`, Booking Reference must be `VN45345`.
* If IS Number = `IS2313`, Booking Reference must be `IS2313`.

---

# 2. IS Number Extraction Improvements (VERY CRITICAL)

The system must accurately extract the IS Number from Travel Confirmation emails.

## Detection Rules

The value is always labelled:

```text
IS Number:
```

Examples:

```text
IS Number: VN40123
IS Number: VN41678
IS Number: IS23492
IS Number: IS34050
IS Number: IS10567
IS Number: MY40586
IS Number: MY6785
IS Number: SG57685
IS Number: SG38456
```

## Supported Prefixes

| Prefix | Country   |
| ------ | --------- |
| VN     | Vietnam   |
| IS     | Sri Lanka |
| SG     | Singapore |
| MY     | Malaysia  |

## Extraction Requirements

* Extract EXACTLY as written.
* Preserve prefix letters.
* Preserve numeric value.
* Remove spaces if present.

Examples:

```text
VN 19785 → VN19785
IS 40567 → IS40567
SG 56789 → SG56789
MY 12345 → MY12345
```

## Validation

Valid:

```text
VN19785
IS40567
SG56789
MY12345
```

Invalid:

```text
19785
40567
56789
12345
```

## Failure Handling

* Return NULL only if the IS Number is truly absent.
* Never guess.
* Never fabricate.
* Never generate fallback values.

---

# 3. Email & Travel Confirmation Parsing

Improve extraction accuracy for all Travel Confirmation documents and emails.

The parser should:

* Read the full email body.
* Read attached documents.
* Read PDF confirmations.
* Read HTML email content.
* Read plain text email content.
* Preserve formatting when possible.

The extraction engine must identify and save all booking-related information accurately.

---

# 4. Additional Fields to Extract & Save

Many Travel Confirmations contain important sections that are currently not being stored.

Extract and save the following fields:

```text
Value Added Services
Above Package Includes
The Above Package Excludes
Terms and Conditions
IMPORTANT NOTES
TIPS
Other Note
Client Request
```

These fields should:

* Be visible in Booking Details page.
* Be editable.
* Be stored in the database.
* Be included during email extraction.
* Be included during manual booking creation.

---

# 5. Booking Save Process

When saving a booking:

1. Extract all booking data.
2. Validate extracted values.
3. Extract IS Number.
4. Set Booking Reference = IS Number.
5. Save every extracted field.
6. Save additional sections listed above.
7. Store raw extracted content for auditing/debugging.
8. Prevent data loss.

---

# 6. Accuracy Improvements

Current extraction sometimes returns incorrect values.

Required improvements:

* Better pattern matching.
* Better OCR handling.
* Better PDF parsing.
* Better email HTML parsing.
* Better section detection.
* Better passenger data extraction.
* Better travel date extraction.
* Better hotel extraction.
* Better flight extraction.
* Better package extraction.

Priority order:

1. IS Number Accuracy
2. Booking Reference Accuracy
3. Travel Dates
4. Passenger Details
5. Hotel Details
6. Flight Details
7. Package Information
8. Additional Notes & Conditions

The system should always prefer extracted source data over generated or inferred values.


sample Travel confermations Inhere 
/Users/itaahaas/Desktop/Sasindu/Booking_System/Travel_Confermations