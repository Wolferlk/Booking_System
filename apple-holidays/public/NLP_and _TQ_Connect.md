Travel_Qutaion Come to = confirm.booking@aahaas.com
Travel PNL Come to = accounts.payable@aahaas.com 

Sample PNL and TQ in here (SampleFiles/TC.docx , SampleFiles/VN19005PNL.xlsx )

readenv files have Creatintial 

Every Qutaion Has PNL Allready Implement the Qutaion    

Inside of the BT_User Curruntly has confirm.booking@aahaas.com
like that I need accounts.payable@aahaas.com  mail box also 

i need to automate Inside backend When new mail is come Mail is automaticaly Process 
when (Methost is Set backend timer check new mail is Resived If new mail resived prosses this mail )

Using All Pnls come to here Use only this for Get pnl details 
IMAP_USERNAME=accounts.receivable@aahaas.com
IMAP_PASSWORD='X(432920426304uz'

Connect this mail too. PNLs should link to the TQ using the Tour Ref numeric part, not the IS Number.

This is the way to connect TQ with PNL:
Travel Quotation: Tour Ref = 469083CNTL
PNL: Tour No = #469083

can Link QT and N&L 
PNL processing not same as QT processing 
Sample N&P Read ur self and understand there shor profit and loss 
soo read P&L (PNL HAs Tour No ref with tq 's Tour Ref ) AND iNPUT THAT DEATILS  Tour Ref  matching perticular Tq 



Here is sample PNL : [SampleFiles/PNL_#464045.eml](../../SampleFiles/PNL_#464045.eml)
Here Is sample Tq : SampleFiles/Re_ Quotation | 402011387896 | Rakshitha - Vietnam - 060626 | 30_Jun_2026 - 06_Jul_2026 | 2 Adults | Vietnam.eml


Normal Way is first come Tq(Travel qutation ) then com Pnl 
That way First auto procces travel qutation is waiting for PNL
when pnl was com to mail automaticaly add data to perticular Tq Booking 

If if first come PNL wait wor travel qutation and Create booking and Fill data and complete 

Need Process is :
TQ come to the mail And create booking instantly , PNL come to other mail add pnl data to perticualr Booking  (Linked Boath)
and Process ---> ground team review 
TQ Emails
Booking created
PNL Email + XLSX
PNL merged
Ground Review

# PNL_incoming_g arrivemail_read
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
