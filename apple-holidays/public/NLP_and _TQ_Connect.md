Travel_Qutaion Come to = confirm.booking@aahaas.com
Travel PNL Come to = accounts.payable@aahaas.com 

Sample PNL and TQ in here (SampleFiles/TC.docx , SampleFiles/VN19005PNL.xlsx )

readenv files have Creatintial 

Every Qutaion Has PNL Allready Implement the Qutaion    

Inside of the BT_User Curruntly has confirm.booking@aahaas.com
like that I need accounts.payable@aahaas.com  mail box also 

i need to automate Inside backend When new mail is come Mail is automaticaly Process 
when (Methost is Set backend timer check new mail is Resived If new mail resived prosses this mail )

Travel_Qutaions connet with PNL You have to fined How to links that boath and Process Loocut the process now(Currently have PNL when manual adding How to process )

Need Process is :
TQ come to the mail And create booking instantly , PNL come to other mail add pnl data to perticualr Booking  (Linked Boath)
and Process ---> ground team review 


# PNL_incoming_gmail_read
mail_address=accounts.payable@aahaas.com
mail_password=<redacted>
IMAP_HOST=outlook.office365.com
IMAP_PORT=993
IMAP_ENCRYPTION=ssl
IMAP_VALIDATE_CERT=true
IMAP_USERNAME=accounts.receivable@aahaas.com
IMAP_PASSWORD=<redacted>
GRAPH_CLIENT_ID=320a42f3-0d13-42e5-b5be-af9c49854260
GRAPH_TENANT_ID=f42f071c-30d7-448e-9465-45e25cf6b548
GRAPH_CLIENT_SECRET=<redacted>
GRAPH_USER=apcc.vendor@aahaas.com
GRAPH_INVOICE_USER=accounts.receivable@aahaas.com
GRAPH_PNL_USER=accounts.payable@aahaas.com
