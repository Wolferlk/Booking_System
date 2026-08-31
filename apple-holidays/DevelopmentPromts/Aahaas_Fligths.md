In the 



b2b_bookings table Has booking only need to show in the component Status confirmed 


b2b_bookings this table id connect with other All Tables booking_id 

When Click on the One booking need to navigate Booking details page and Need to show All the details available in the thease table Creativly modern CReativly 

#Dirrectly read with this table dont need Apis 
irrectly read with db 


When Doing this task Dont touch live data Read only 
Ensure live data is safe 
DOnt loss any data Safely do this task creativly and more accurate 

If U need more Details U can Check with this repo 
/Users/itaahaas/Desktop/Sasindu/Fligths_dash (Dont change anithing..read only )


Table:b2b_bookings
Columns:
 
id	bigint UN AI PK
uuid	varchar(36)
type	varchar(20)
user_id	bigint UN
order_id	bigint UN
category_id	bigint UN
amount	decimal(10,2)
currency	varchar(10)
status	varchar(255)
order_status	varchar(255)
payment_status	varchar(255)
payment_method	varchar(255)
payment_reference	varchar(255)
transaction_id	bigint UN
booking_data	longtext
deleted_at	timestamp
created_at	timestamp
updated_at	timestamp
 
 
Table:b2b_booking_flights
Columns:
 
id	bigint UN AI PK
booking_id	bigint UN
pnr_number	varchar(20)
booking_type	varchar(20)
aahaas_booking_id	bigint UN
aahaas_order_id	bigint UN
airline_code	varchar(10)
airline_name	varchar(100)
departure_city	varchar(100)
arrival_city	varchar(100)
departure_date	date
return_date	date
trip_type	varchar(20)
adult_count	tinyint UN
child_count	tinyint UN
infant_count	tinyint UN
cabin_class	varchar(30)
base_fare	decimal(14,2)
taxes	decimal(14,2)
total_amount	decimal(14,2)
currency	varchar(10)
status	varchar(30)
ticket_status	varchar(30)
flight_data	longtext
passenger_data	longtext
issued_at	timestamp
ticketed_at	timestamp
deleted_at	timestamp
created_at	timestamp
updated_at	timestamp
 
 
Table:b2b_booking_hotels
Columns:
 
id	bigint UN AI PK
booking_id	bigint UN
aahaas_prebooking_id	bigint UN
aahaas_order_id	bigint UN
hotel_id	bigint UN
hotel_name	varchar(255)
hotel_code	varchar(50)
star_rating	tinyint UN
city	varchar(100)
country	varchar(100)
check_in_date	date
check_out_date	date
nights	tinyint UN
room_count	tinyint UN
adult_count	tinyint UN
child_count	tinyint UN
room_category	varchar(100)
room_type	varchar(100)
meal_plan	varchar(20)
room_rate	decimal(14,2)
total_amount	decimal(14,2)
currency	varchar(10)
status	varchar(30)
confirmation_number	varchar(50)
hotel_data	longtext
guest_data	longtext
room_breakdown	longtext
special_requests	text
confirmed_at	timestamp
cancellation_info	longtext
deleted_at	timestamp
created_at	timestamp
updated_at	timestamp
 
 
Table:b2b_booking_insurances
Columns:
 
id	bigint UN AI PK
booking_id	bigint UN
aahaas_booking_id	bigint UN
aahaas_order_id	bigint UN
provider	varchar(50)
policy_type	varchar(100)
plan_name	varchar(255)
policy_number	varchar(100)
coverage_start_date	date
coverage_end_date	date
coverage_days	smallint UN
destination_country	varchar(100)
traveler_count	tinyint UN
premium_amount	decimal(14,2)
coverage_amount	decimal(14,2)
total_amount	decimal(14,2)
currency	varchar(10)
status	varchar(30)
insurance_data	longtext
traveler_data	longtext
coverage_details	longtext
issued_at	timestamp
expires_at	timestamp
deleted_at	timestamp
created_at	timestamp
updated_at	timestamp
 
 
Table:b2b_booking_lifestyles
Columns:
 
id	bigint UN AI PK
booking_id	bigint UN
aahaas_prebooking_id	bigint UN
aahaas_order_id	bigint UN
lifestyle_id	bigint UN
lifestyle_name	varchar(255)
category	varchar(100)
sub_category	varchar(100)
service_date	date
service_time	time
adult_count	tinyint UN
child_count	tinyint UN
package_count	tinyint UN
unit_price	decimal(14,2)
discount_amount	decimal(14,2)
total_amount	decimal(14,2)
paid_amount	decimal(14,2)
currency	varchar(10)
status	varchar(30)
confirmation_number	varchar(50)
lifestyle_data	longtext
participant_data	longtext
special_requests	text
confirmed_at	timestamp
cancellation_info	longtext
deleted_at	timestamp
created_at	timestamp
updated_at	timestamp
 
 
Need to view Creativly booking details , Can download PDF of details 
need to view and download Invoices 