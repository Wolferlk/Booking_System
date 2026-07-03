

**Bug Fix / Correction Prompt**

Please fix the following issues. For each one, the current (wrong) behavior and the expected behavior are described. Investigate the data mapping/source for each field before changing UI code, since most of these look like field-binding or data-source errors.

**IS Number**
- Current: The IS Number field is blank.
- Expected: Populate the IS Number from its correct source field.

**Agenda – Date**
- Current: The Date field is blank.
- Expected: Display the correct agenda date for each entry.

**Agenda – Location**
- Current: Shows the activity name or "Day 1 / Day 2" instead of the location.
- Expected: Show the actual location. The location field is being mis-mapped to the activity/day label — bind it to the correct location source.

**Agenda – Meeting Time**
- Current: Meeting time is incorrect.
- Expected: Display the correct meeting time (verify time zone / source field).

**Agenda – From/To**
- Current: The From/To field shows the wrong activity.
- Expected: Map From/To to the correct corresponding activity for that row.

**Agenda – To / Activity (truncation)**
- Current: The "To/Activity" field shows only part of the activity name (truncated).
- Expected: Display the full activity name (remove truncation, allow wrapping or widen field).


**New Booking – OneDrive file extraction error**
- Current: When browsing via OneDrive and extracting the file, this error appears: `Failed to execute 'json' on 'Response': Unexpected end of JSON input`.
- Expected: Handle the response correctly. This error means the API returned an empty or non-JSON body. Add validation: check the response status and body before calling `.json()`, and surface a clear error if the file/response is empty.

**New Booking – Customer Information**
- Current: In the Customer Information section, the Customer/Guest field shows hotel details.
- Expected: Show the guest details. The field is bound to the hotel object instead of the guest object — correct the mapping.

**Provider assignment (multi-day)**
- Current: When the customer has personal arrangements on Day 1 and Day 3, the app still shows Aahaas as the provider for all days.
- Expected: Respect the per-day provider. Days with personal arrangements should show the correct provider (not default to Aahaas across all days).

**Mailbox – Search clarity**
- Current: It is unclear which value the search uses.
- Action needed: Confirm and define whether search should use the File Number or the CNTL Number, then make the search field label/placeholder explicit (e.g. "Search by CNTL Number").

**Mailbox – Missing tour confirmation emails**
- Current: Some tour confirmation emails (from 22/06/2026 to now) are not displayed.
- Note: The Booking Team confirmed the emails were sent from `confirm.booking@aahaas.com`.
- Expected: Investigate why emails from this sender/date range are not appearing — check the sender filter, date filter, and the email-sync/ingestion logic for that mailbox.

---

A couple of things worth flagging before you hand this off: the Mailbox search item is a question rather than a defined fix, so the assistant can't fully resolve it until you decide on File Number vs CNTL Number — I'd settle that first. And if you can share the relevant data model or the API response shape, the field-mapping bugs (Location, From/To, Customer/Guest, Tour Reference) will be much faster to fix correctly.

Want me to tailor this for a specific tool or stack (e.g. React, a particular backend), or turn it into a ticket-style format instead?