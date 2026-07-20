Create AS-Bookings page and add to NAV bar  



I need good filter options and need fast dataload 

when list view need page by show add pages but filter counts need to be correct

defult filter is this week created data 
latest created first show 


Create like ALL booking Like page to view all bookings That API retrive name AS-bookings IS Number need to be primary key 

When Clicking on one page Can view Each booking details
Using deatils can create agenda can view (FOr Now DOnt need to store any thing in db only need view )

Need good filter 

U can use any API in side this FIle AppleSystem_API_Intigrate/Apple Holidays APIs Live.postman_collection.json

need more modern and more creative view In AS booking detail PAge need to View all the booking deatils that perticular Booking related all the details booking confirmation need to view 

can generate and download 2 tyes of PDF ...
1. ALl detalils with amounts ost 
2. All details without any costing amounts 


using this api can 
get perticular day all created qutations list 
{{api_url}}/api/quotation/list?from_arrival_date=2026-6-1&to_arrival_date=2026-6-30&status[]=1&status[]=2&user_ids[]=1&user_ids[]=2

in here include for each booking 

"id": 473659,
"quotation_no": "471275",



Confirmed booking's 
status is 2 only get this and 

For get each COnfermation details can  this api 


{{api_url}}/api/quotation/template/quote
FOr that 
Need to Input like this 

{
	"quotation_no": "471275", 
	"reference_id": "473659"
}

for 
quotation_no need to ADD "quotation_no"
reference_id NEED TO ADD "id":

