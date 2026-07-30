Add B2C bookings In side the all thebooking and Add filter B2C , B2B

Do this 

need Now Booking have like Allthe things same to that bookings also 
Booking  details page agenda creating driver assigmnets PNL
Agenda generatings tikets issue Calls Whatsapp msg all the things 


Now already created B2B Operation in our system I need to COnnect with B2C
Aahaas IS B2C System Of the Our SYstem 

# I need to show All Aahaas Oder in The All oders page In the ops System 
Use This Db   production_live1.checkouts_more_data
Read this full table coulums and read some datas also and get idea 

# IS number and Booking 
There is a oderID get that Same as IS number and Booking Ref in ops System 

# country Find 
There is a ProductId  and Go to table tbl_lifestyle and Fine COuntry Coulum the is COuntry that is that oder country 

# Arrival Departure dates get 
production_live1.checkouts_more_data thitable have Service_date
perticular Oder has Muliple dates there for oder Date asending to desending get forst date as Arraivale and departure 

if only one product in the oder that date is the Arrivale and deparcture same date

# pax Count 
adult_quantity , child_quantity 


# argent need to set 
Aahaas B2C 

# Cilent Detils
production_live1.checkouts_more_data has oder id And production_live1.tbl_checkout_ids; has id and FInd USer id 
using USer ID - production_live1.users;

production_live1.tbl_customer; in this table 
customer_id is = tbl_checkout_ids --> USer UserID

# Product categories in here 
production_live1.tbl_maincategory;
production_live1.tbl_submaincategory;
production_live1.tbl_submaincategory;
production_live1.tbl_submaincategorysub;

# Itinerary
of the Itinerary need to show Perticular oder 
Products with detils 


# PNLs data also Need to add and need to shoe in booking details 





# Aahaas B2C Live Database Configuration
DB_DATABASE_B2C=production_live1 

here is the aahaas DB Live db DOnt Harm to data and dont do any changes of this database only Read and Need to Fetch to Ops DB upcompont travels only and Need to trigger Today creted booking need to auto fetch to Ops db in the next day Middle nigth auto maticly tru node back end 

# Project is there
U can get idea of this project How to Create oders like that all the things 
Desktop/Sasindu/AahaasAdmin(FrontAndBack)/dashboard_backend

APIS in here dashboard_backend/routes/api.php Read all and get idea about DB 

