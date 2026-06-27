# Booking  & Agenda Module – Error Corrections and Improvements


## Objective
l booking extraction, document parsing, andImprove the emai agenda generation modules to achieve accurate booking data extraction and a reliable drag-and-drop scheduling experience.


##IS_Number correctly identyfy 
Best Try To Find IS_NUmber All Booking has Is NUmber its need to be Booking ref(Primary key in Booking )
Example Is_numbers are  : VN40123 VN41678 IS23492 IS34050 IS10567 MY40586 MY6785 SG57685 SG38456 

All the IS_Numbers are Starting From Only VN Or IS or SG or MY Correctly identyfy IS number when Booking creating that should be the Booking RTef Automaticaly identyfy 



### 1. Using Email & Document Extraction Issues

#### Location Detection
- Fix location extraction logic.
- Capture the exact destination/location mentioned in the booking confirmation or Tour Confirmation (TC).
- Avoid extracting partial or incorrect location names.
#### Tour Name Extraction
- Extract the complete official tour title.
- Do not shorten or truncate the tour name.
- Match the Tour Confirmation (TC) document exactly.
#### Description Extraction
- Booking description must exactly match the description in the TC.
- Prevent missing or incomplete descriptions.
#### Missing Tours
- Some tours are not being extracted.
- Improve parsing logic to detect every booked tour and service from emails and uploaded documents.
#### Date Extraction
- Fix incorrect date detection.
- Support all common date formats.
- Automatically extract dates from every supported document.
- If multiple services exist, assign the correct date to each service.
#### Internal Tours & Flight Transfers
- Detect and import:
 - Internal Tours
 - Flight Transfers
 - Airport Transfers
- These services should appear automatically in the booking agenda.
#### Service Type Detection
- Improve service type classification.
- Avoid incorrectly assigning "Own Arrangement."
- Correctly identify:
 - SIC
 - Private
 - Shared
 - Transfer
 - Flight
 - Internal Tour
 - Accommodation
 - Own Arrangement (only when explicitly mentioned)
---
# Agenda Module Improvements
## Drag & Drop Functionality
Improve the drag-and-drop experience.
### Required Changes
- Users should be able to drag tours directly to the exact date cell.
- Movement between dates should be smooth and accurate.
- Support drag-and-drop inside the movement chart.
### Preserve Original Dates
Currently, dragging a tour changes all related dates automatically.
Expected behavior:
- Only the selected agenda item should move.
- Other dates and linked services must remain unchanged unless the user explicitly edits them.
### SIC Time Range Columns
Add dedicated time-range columns for SIC tours.
Example:
| Date | Time From | Time To | Service |
|------|-----------|---------|---------|
This will improve scheduling clarity.
---
# Overall Improvements
- Improve OCR accuracy.
- Improve PDF parsing.
- Improve DOCX parsing.
- Improve email content extraction.
- Validate extracted data against the uploaded TC before saving.
- Increase extraction accuracy for locations, dates, service types, and tour names.
- Handle different booking formats from multiple travel suppliers.
- Add validation to highlight missing or uncertain extracted information for manual review.
## Expected Result
The system should:
- Accurately extract booking details from emails and uploaded files.
- Capture complete tour names.
- Capture correct locations.
- Capture accurate dates.
- Include all tours, transfers, and internal services.
- Correctly identify service types.
- Generate a reliable agenda without changing unrelated dates.
- Provide smooth drag-and-drop functionality with accurate date placement.