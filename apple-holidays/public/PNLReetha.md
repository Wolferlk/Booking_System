Dont When Booking Creating Dont get pnls Any where Only use this method 
Every Clicking need to Fretch dat from that PNL data 

I have already API Ucan use that api or ucan use with ur Own Create api 

When Fetching data 
try With : Tour Ref , IS Number , Reference Number , 
If one of this ID match from pnl : is_number , tour_ref , invoice_number

or any id Ineed to Link my booking with that db PNL 

NPL Time to time updating there for i need to Refetch that data For perticular Booking Real time Update 

like When Booking details page Open refetch pnl data From Databass Like 

some time or if Not Connect with PNL There For need option to manual link PNL From dat abass Having any id serch 

try to do that with no erro and advancely optionss 
Need to View front end When PNL last fetch time and can manually refetch for each Booking and in the settings can fetch all booking 

get pnl data derecly that acccounts data bass 


apis(Mutchbetter not use thi apis only read data how like)
https://invoice-processor.aahaas.com/api/pnl/items/1
https://invoice-processor.aahaas.com/api/pnl/headers

Accounts pnl  Team use this Db 
DB_CONNECTION=mysql
DB_HOST=35.197.143.222
DB_PORT=3306
DB_DATABASE=invoice_processor
DB_USERNAME=root
DB_PASSWORD="&l+>XV7=Q@iF&B9s"

#One p&l Record Has Many PNL Items 

Table for pnl : pnl_records , pnl_items

Table: pnl_items

Columns:
id
bigint UN AI PK
pnl_record_id
bigint UN
control_number
varchar(255)
invoice_number
varchar(255)
start_date
date
end_date
date
type
varchar(255)
credit_type
varchar(255)
agent_name
text
client_name
text
check_in_date
date
check_out_date
date
hotel_name
text
transport_name
text
service_name
text
country_code
varchar(255)
currency
varchar(255)
amount_original
decimal(12,2)
exchange_rate
decimal(10,4)
amount_converted
decimal(12,2)
item_details
text
status
varchar(50)
created_at
timestamp
updated_at
timestamp
synced_at
timestamp
sync_status
varchar(255)
deleted_at
timestamp


Table: pnl_records

Columns:
id
bigint UN AI PK
sno
varchar(255)
message_id
varchar(255)
from_email
varchar(255)
from_address
varchar(255)
from_name
varchar(255)
subject
varchar(255)
body
longtext
body_html
longtext
extracted_data
json
received_at
timestamp
vendor_name
varchar(255)
invoice_number
varchar(255)
is_number
varchar(255)
pnl_date
date
pnl_month
varchar(20)
pnl_year
varchar(10)
invoice_date
date
amount
decimal(12,2)
profit_loss
decimal(12,2)
total_pax
int
total_nights
int
actual_amount
decimal(15,2)
budget_amount
decimal(15,2)
process
varchar(50)
paid_amount
decimal(15,2)
exchange_rate
decimal(10,4)
gst
decimal(10,2)
invoice_no
varchar(100)
remarks
text
exchange_rate_used
decimal(10,4)
currency
varchar(3)
category
varchar(255)
country_code
varchar(255)
date
date
month
varchar(255)
year
varchar(255)
status
varchar(255)
update_status
varchar(255)
update_count
int
excel_file_name
varchar(255)
update_notes
text
excel_updated
tinyint(1)
excel_updated_at
timestamp
excel_update_hash
varchar(64)
processed_to_excel
tinyint(1)
start_date
date
end_date
date
tour_ref
varchar(255)
agent_name
varchar(255)
read_status
enum('unread','read')
processing_status
varchar(50)
has_attachments
tinyint(1)
created_at
timestamp
updated_at
timestamp
deleted_at
timestamp
last_updated_at
timestamp
control_number
varchar(255)



