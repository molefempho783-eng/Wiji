# Single source for Wiji legal text. build.py turns this into the website pages
# AND the in-app React Native screens, so the two never drift apart.

EFFECTIVE = "20 October 2026"
OPERATOR = "DAYLY Technologies"
EMAIL = "molefempho783@gmail.com"
SITE = "https://communitychat-f3fb0.web.app"
LOCATION = "Hatfield, Pretoria, Gauteng, South Africa"

# Sections whose title is in HIGHLIGHT are marked as important (CPA s49).
HIGHLIGHT = {"5. Safety features and emergencies", "15. Disclaimers", "16. Limits on our liability", "17. Indemnity"}

# Each section: (title, [blocks]). A block starting with "- " is a bullet.

TERMS_INTRO = (
    "These Terms are an agreement between you and " + OPERATOR + " (\"Wiji\", \"we\", \"us\"), "
    "the South African business that runs the Wiji app and website. Please read them carefully, "
    "especially the highlighted sections, which limit our liability or place risk on you."
)

TERMS = [
    ("1. Agreeing to these Terms", [
        "By creating a Wiji account or using the app, you agree to these Terms and to our Privacy Policy. If you don't agree, please don't use Wiji.",
        "We may update these Terms when the app changes or the law requires it. We will show the new date at the top and tell you in the app before important changes take effect. If you keep using Wiji after that, the new Terms apply.",
    ]),
    ("2. Who can use Wiji", [
        "You must be at least 18 years old and able to enter into a binding agreement.",
        "You must give true, current details about yourself and keep them up to date.",
        "One person, one account. Don't share your account, sell it, or use someone else's.",
        "You are responsible for everything done through your account, so keep your password, phone and email secure. Tell us straight away if you think someone else has access.",
    ]),
    ("3. What Wiji is (and isn't)", [
        "Wiji is a platform. It helps people find rides, pay drivers and businesses, discover local deals, order from shops, and join communities, chats and calls.",
        "- Drivers on Wiji are independent. Wiji is not a transport operator and does not employ drivers.",
        "- Businesses on Wiji sell their own products and services. Wiji is not the seller.",
        "- Wiji is not a bank and does not keep a balance or hold your money. Card payments are processed by Paystack (see section 7).",
        "We work hard to keep Wiji safe and useful, but we can't control everything people do on it.",
    ]),
    ("4. Rides for passengers", [
        "- Before you confirm a ride, the app shows you the fare. For now the fare you see is the fare you pay.",
        "- When your driver arrives, check that the car, number plate and driver match the app. Give your trip PIN only to the driver shown. If anything doesn't match, don't get in. Use \"Not my driver\" and request again.",
        "- Treat drivers and their cars with respect. Wear a seatbelt. No violence, threats, harassment, weapons, illegal items or damage to the vehicle.",
        "- You may cancel before the trip starts. Drivers may also cancel, for example if they feel unsafe.",
        "- You are responsible for your belongings. If you leave something behind, contact us and we will try to connect you with the driver.",
    ]),
    ("5. Safety features and emergencies", [
        "Wiji includes safety tools: verified drivers, a trip PIN, trip sharing with trusted contacts, incident reporting and an emergency button.",
        "The emergency button alerts your trusted contacts and the Wiji safety team, and can share your location. It does not replace the police, ambulance or other emergency services, and we can't promise how quickly anyone responds. In danger, always call SAPS on 10111 or 112 from a mobile phone.",
        "Safety features depend on your phone, battery, signal and location settings. Keep them on during trips.",
    ]),
    ("6. Driving on Wiji", [
        "To drive, you must apply in the app and be approved by the Wiji safety team. You agree that:",
        "- The documents and details you give are true and your own: your ID, driving licence, Professional Driving Permit (PrDP), vehicle papers, licence disc, insurance and anything else we ask for.",
        "- You consent to a criminal record check and vehicle check before approval and again at least once a year, and you will update documents before they expire.",
        "- You hold, and keep, every permit and licence the law requires to carry passengers for reward, including any operating licence under the National Land Transport Act. Getting these is your responsibility.",
        "- Your vehicle is roadworthy, licensed and insured for carrying passengers.",
        "- You are independent, not an employee, agent or partner of Wiji. You decide when you drive. You are responsible for your own tax, fines and expenses.",
        "- You won't drive under the influence, use your phone unsafely, carry extra passengers off the app, or let anyone else drive using your account.",
        "- You treat every passenger with respect and never ask for or use a passenger's details outside a trip.",
        "Wiji keeps a platform fee from each fare paid in the app (currently 5%). The rest is paid out to the bank account you set up, through Paystack.",
        "We may pause or remove your driver access if your documents expire, a check fails, or a serious incident is reported (see section 9).",
    ]),
    ("7. Payments, fees and refunds", [
        "- Card payments in Wiji are processed by Paystack, a licensed payment provider. Paystack's own terms also apply. Wiji never sees or stores your full card number. We only keep details like the card brand and last 4 digits.",
        "- When you pay a driver or business, the money goes through Paystack to that driver's or business's bank account. Wiji keeps its platform fee (currently 5% of the payment, which comes off the amount the payee receives unless the app says otherwise).",
        "- Check who you are paying, the amount and any order details before you confirm. Payments to the wrong person may not be recoverable.",
        "- If a business cancels a paid order, the payment is refunded to your card. Card refunds usually take 5–10 working days, depending on your bank.",
        "- For other problems with a payment, contact the driver or business first, then us. We will help where we can. You also keep any rights you have with your bank, including chargebacks.",
        "- We may delay, reverse or block a payment or payout we reasonably believe is fraudulent, unlawful or linked to a safety investigation.",
        "- Prices shown by businesses include VAT where the business is VAT-registered.",
    ]),
    ("8. Businesses, shops and deals", [
        "If you list a business on Wiji, you agree that:",
        "- You are allowed to run the business, and the verification details you give us are true.",
        "- Your listings, menus, prices, specials and deals are accurate and lawful, and you honour them.",
        "- You are the supplier of what you sell. You must meet your duties to customers under the Consumer Protection Act and other laws, including fair refunds, safe goods and honest marketing.",
        "- You won't sell anything illegal, stolen, counterfeit, dangerous, age-restricted without proper checks, or prohibited by Paystack.",
        "- You use customer details only to fulfil their orders.",
        "Customers buy from the business, not from Wiji. We are not responsible for the quality, safety or delivery of what businesses sell, but we will act on complaints and may remove businesses that break these Terms.",
    ]),
    ("9. Incidents, reviews and a fair process", [
        "Anyone can report an incident or a person in the app. The Wiji safety team reviews reports. When a serious report is made, especially about violence, gender-based violence or sexual misconduct, we may suspend the accounts involved straight away to keep people safe while we look into it.",
        "We aim to be fair to everyone:",
        "- We tell you, in general terms, why your account was limited, unless doing so would put someone at risk or break the law.",
        "- You can give your side and ask for a review.",
        "- We decide based on the information we have. This is not a court process and does not decide anyone's guilt.",
        "We cooperate with SAPS and other authorities when the law requires it or when someone's safety is at serious risk.",
    ]),
    ("10. Communities, chats, calls and the map", [
        "- Community and group admins set their own rules and are responsible for moderating their spaces, within these Terms.",
        "- When you post an activity, location, special or meetup on the map, others can see it. Only share places you are comfortable sharing, and use good judgement when meeting people.",
        "- Don't record, screenshot or share other people's private chats or calls in ways that break the law or hurt them.",
    ]),
    ("11. Things you must not do", [
        "- Break the law, or help someone else do so.",
        "- Harass, threaten, stalk, bully, dox or impersonate anyone.",
        "- Post hate speech, sexual content involving minors, non-consensual intimate images, violent threats or graphic violence.",
        "- Commit fraud, scams, money laundering or fake payments, or use Wiji to collect money for something you won't deliver.",
        "- Spam people, or create fake accounts, reviews or reports.",
        "- Hack, scrape, overload or reverse-engineer Wiji, or get around our security or safety checks.",
        "- Use Wiji to contact a driver or passenger after a trip in a way they haven't agreed to.",
    ]),
    ("12. Your content", [
        "You own what you post, such as messages, photos, posts and reviews. You give Wiji a non-exclusive, royalty-free licence to store, show and process that content only as needed to run, protect and improve Wiji. The licence ends when you delete the content or your account, except for copies we must keep (see the Privacy Policy).",
        "You are responsible for your content and must have the right to post it. We may remove content that breaks these Terms or the law.",
    ]),
    ("13. Our name and app", [
        "The Wiji name, logo, app and website belong to " + OPERATOR + ". You may use the app for its normal purpose, but you may not copy, sell or reuse our brand or code without written permission.",
    ]),
    ("14. Other services we rely on", [
        "Wiji uses services from other companies, including Paystack (payments), Google Firebase (accounts, data and notifications), Google Maps (maps and locations) and Expo (app updates and notifications). We are not responsible for outages or errors in those services, but we choose providers carefully.",
    ]),
    ("15. Disclaimers", [
        "We provide Wiji \"as is\" and \"as available\". We don't promise that it will always work, be free of errors, or that a ride, driver, business or product will always be available. Maps, distances and fares are estimates.",
        "Nothing in Wiji is financial, legal or tax advice.",
        "Nothing in these Terms takes away rights you have under the Consumer Protection Act or other law that can't be excluded.",
    ]),
    ("16. Limits on our liability", [
        "As far as the law allows, Wiji is not liable for:",
        "- what drivers, passengers, businesses or other users do or fail to do, including loss, injury or damage during a trip or from goods bought;",
        "- indirect or consequential loss, such as lost profit, income or data;",
        "- loss caused by your device, network, lost or shared passwords, or by events outside our reasonable control.",
        "Where we are liable, our total liability to you is limited to the platform fees we earned from your use of Wiji in the 6 months before the claim, or R500, whichever is more.",
        "These limits do not apply to loss caused by our gross negligence or wilful misconduct, or where the law does not allow them.",
    ]),
    ("17. Indemnity", [
        "If someone makes a claim against Wiji because you broke these Terms, broke the law, or because of your content, trips or sales, you agree to cover the reasonable costs and losses that result, as far as the law allows.",
    ]),
    ("18. Suspension, ending and deleting your account", [
        "You can stop using Wiji and delete your account at any time. See " + SITE + "/delete-account for how.",
        "We may suspend or close an account that breaks these Terms, creates a safety, fraud or legal risk, or has been inactive for a long time. Where it is safe and fair, we will tell you first and explain why.",
        "Sections that by their nature should continue (like payments owed, liability and disputes) keep applying after your account ends.",
    ]),
    ("19. Complaints and disputes", [
        "If something goes wrong, please contact us first at " + EMAIL + ". We aim to respond within 5 working days and to resolve complaints fairly.",
        "If we can't resolve it, you may approach the National Consumer Commission, the Consumer Goods and Services Ombud, or a court with jurisdiction. These Terms are governed by the law of the Republic of South Africa.",
    ]),
    ("20. Our details (Electronic Communications and Transactions Act)", [
        "- Business: " + OPERATOR + ", which operates Wiji",
        "- Based in: " + LOCATION,
        "- Email: " + EMAIL,
        "- Website: " + SITE,
        "Our full registration details and physical address for legal notices are available on request.",
    ]),
]

PRIVACY_INTRO = (
    "This Privacy Policy explains what personal information Wiji collects, why, who we share it with, "
    "and the rights you have under the Protection of Personal Information Act, 2013 (POPIA). "
    + OPERATOR + " is the responsible party for your information."
)

PRIVACY = [
    ("1. Who we are", [
        "- Responsible party: " + OPERATOR + " (operator of Wiji), " + LOCATION,
        "- Information Officer: Mpho Molefe",
        "- Contact: " + EMAIL,
    ]),
    ("2. What we collect", [
        "- Account and profile: name, username, email, phone number, profile photo, bio, and the date you accepted our Terms.",
        "- Location: your location while you use the map, set pickup and drop-off, or are on a trip. Drivers' locations are collected while they are online. We collect location only after you allow it in your phone settings.",
        "- Trips: pickup and destination, route, times, fare, trip PIN checks, cancellations and ratings.",
        "- Driver applications: ID, driving licence, PrDP, vehicle papers, licence disc, insurance, photos, and the results of criminal record and vehicle checks.",
        "- Safety: trusted contacts you add, trip shares, emergency button alerts with your location, and incident reports and the evidence you send.",
        "- Payments: payment amounts, status, references, and the card brand and last 4 digits. Drivers and businesses: bank name and account details for payouts, held through Paystack. We never store your full card number.",
        "- Businesses: business name, verification documents, listings, specials, orders and customers' order details.",
        "- Messages, communities and calls: the messages, photos and files you send, the communities and groups you join, and call details like who called whom, when and for how long.",
        "- Device and usage: device type, app version, push notification token, crash logs and how you use features.",
        "- Camera and microphone: the camera is used to scan QR codes to pay and to take photos you choose to upload, and the microphone is used for calls. We don't access them in the background.",
    ]),
    ("3. Special personal information", [
        "Criminal record checks for drivers, and some incident reports, include special personal information under POPIA. We process it only with the driver's or reporter's consent, to protect passengers and the public, to meet legal duties, or to establish or defend legal claims. Only the Wiji safety team can see it.",
    ]),
    ("4. Why we use it", [
        "- To create your account and run the app's features: rides, payments, shops, deals, map, communities, chats and calls.",
        "- To keep people safe: verify drivers and businesses, match trips, share trips and emergency alerts, and investigate incidents.",
        "- To prevent and detect fraud, abuse and security problems.",
        "- To send notifications about your trips, orders, payments, messages and nearby deals. You can turn these off in your phone's settings.",
        "- To fix bugs, measure how the app is used and improve it.",
        "- To meet legal duties, such as tax records and lawful requests from authorities.",
        "We rely on your consent, the need to perform our agreement with you, our legal obligations, and our legitimate interest in running a safe service, as POPIA allows.",
    ]),
    ("5. Who can see your information", [
        "- During a trip, the passenger and driver see each other's first name and photo, the driver's car and plate, and live location.",
        "- Businesses see what is needed to fulfil your order.",
        "- People in your communities and chats see what you post there. Map posts can be seen by others nearby.",
        "- Your trusted contacts receive your trip details and location when you share a trip or press the emergency button.",
        "- Service providers that run parts of Wiji for us: Paystack (payments and payouts), Google Firebase and Google Cloud (accounts, database, file storage, functions and notifications), Google Maps (maps and directions), and Expo (push notifications and app updates). They may only use your information to provide their service to us.",
        "- SAPS, courts or regulators when the law requires it, or to protect someone from serious harm.",
        "We do not sell your personal information.",
    ]),
    ("6. Information sent outside South Africa", [
        "Some of our providers, such as Google, store data on servers outside South Africa. We only use providers that are bound by laws or agreements that protect personal information to a standard similar to POPIA, as section 72 requires.",
    ]),
    ("7. How long we keep it", [
        "- Account and profile data: while your account is open.",
        "- Trip, payment and order records: up to 5 years, for tax, accounting, fraud and dispute reasons.",
        "- Driver documents and checks: while you are an active driver, and for up to 3 years after, to handle safety complaints and legal claims.",
        "- Incident reports and safety records: as long as needed to protect users and handle claims, generally up to 5 years.",
        "- Chats and posts: until you or the community deletes them, or your account is deleted.",
        "When we no longer need information, we delete it or make it anonymous. Backups may keep copies for a short time before they are overwritten.",
    ]),
    ("8. How we protect it", [
        "We use secure connections, Firebase security rules that limit who can read each record, restricted access for staff, and payment handling by Paystack. No system is perfectly secure. If a breach affects you, we will tell you and the Information Regulator as POPIA requires.",
    ]),
    ("9. Your rights", [
        "Under POPIA you can:",
        "- ask what information we hold about you and get a copy;",
        "- ask us to correct or delete it;",
        "- object to some uses, and withdraw consent at any time (this doesn't affect what we did before);",
        "- say no to direct marketing;",
        "- complain to the Information Regulator at inforegulator.org.za.",
        "To use these rights, email " + EMAIL + ". We may need to confirm your identity first. To delete your account, see " + SITE + "/delete-account.",
    ]),
    ("10. Children", [
        "Wiji is for people aged 18 and over. We don't knowingly collect information from children. If you think a child is using Wiji, tell us and we will remove the account.",
    ]),
    ("11. Marketing", [
        "We only send you marketing messages if you agreed to them, and every message includes a way to opt out. Notifications about your own trips, orders and payments are not marketing.",
    ]),
    ("12. Decisions about drivers and businesses", [
        "Driver and business approvals are made by people on the Wiji safety team, not by an automated system alone.",
    ]),
    ("13. Changes to this policy", [
        "We will update this policy when our app or the law changes, show the new date at the top, and tell you in the app about important changes.",
    ]),
]

DELETE = [
    ("How to delete your account", [
        "Email " + EMAIL + " from the email address on your Wiji account, with the subject \"Delete my Wiji account\". Include your username so we can find your account.",
        "We will confirm the request with you and delete your account within 30 days.",
    ]),
    ("What we delete", [
        "- Your profile, photo, username and login",
        "- Your saved cards (removed from Paystack), trusted contacts and settings",
        "- Your location history and push notification tokens",
        "- Your posts, map activities and messages (messages in group chats are shown as from a \"Deleted user\")",
    ]),
    ("What we keep, and for how long", [
        "- Trip, payment and order records: up to 5 years, as required for tax, accounting and fraud prevention",
        "- Incident reports and safety records: as long as needed to protect users and handle claims, generally up to 5 years",
        "- Driver documents and checks: up to 3 years after you stop driving",
        "These records are locked away and only used for those reasons.",
    ]),
    ("Driver or business accounts", [
        "If you drive or sell on Wiji, make sure any pending payouts and open orders are finished first. We will close your payout setup with Paystack as part of the deletion.",
    ]),
]
