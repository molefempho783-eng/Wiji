"""Wiji promoter programme: full terms and the figures used on the explainer page.

Keep PROGRAM in step with functions/.env (AFFILIATE_*) and services/affiliates.ts.
"""
from content import OPERATOR, EMAIL, SITE

PROMOTER_EFFECTIVE = "5 November 2026"

PROGRAM = dict(rate=20, hold=30, payer=90, payee=180, minimum=200, claim=7, cap=25)
P = PROGRAM

PROMOTER_INTRO = (
    f"These terms are the rules of the Wiji Promoter Programme, run by {OPERATOR} (\"Wiji\", \"we\", \"us\"). "
    "They sit alongside the Wiji Terms and Conditions and the Privacy Policy, which also apply to you. "
    "If these terms and the Wiji Terms and Conditions disagree about the promoter programme, these terms win. "
    "A short, plain-language version is on the promoter page. Please read the highlighted sections carefully."
)

PROMOTER_HIGHLIGHT = {"8. Fair play and checks", "9. Advertising and honesty rules", "13. Our responsibility to you"}

PROMOTER_TERMS = [
    ("1. What the programme is", [
        "The Wiji Promoter Programme lets you share Wiji with other people and earn a share of what Wiji earns when the people you brought in use the app and pay for things in it.",
        "It is not a job, a franchise or an investment. You are not an employee, agent or partner of Wiji. You choose if, when and how you promote, and we do not promise you any amount of earnings.",
    ]),
    ("2. Who can join", [
        "- You are 18 or older and have a Wiji account in good standing.",
        "- You apply in the Wiji app (Profile, then Promoter) or in the Wiji portal, and the Wiji team approves your application. We can decline an application, and we will tell you why so you can apply again.",
        "- You have one promoter account. Do not apply twice or on behalf of someone else.",
        "- To be paid, you add a South African bank account in your own name (Profile, then Payouts).",
        "- You give us true details about yourself and where you promote, and keep them up to date.",
    ]),
    ("3. Your code and link", [
        "When you are approved you get a personal promoter code and a personal link that looks like " + SITE.replace("https://", "") + "/r/YOURCODE/.",
        "We may change or withdraw a code that is misleading, offensive, impersonates someone, or uses another person's or brand's name without permission.",
        "You may not use your own code for your own account, and you may not pay yourself through a referral.",
    ]),
    ("4. Who counts as someone you brought in", [
        f"A person counts as someone you brought in when they type your code in the \"Promoter code\" box when they sign up, or within {P['claim']} days of creating their Wiji account.",
        "Each person can use one promoter code, once. After that, it cannot be changed, so please do not tell people to \"add it later\" after the first week.",
        "Opening your link or downloading the app does not count by itself. The person must enter your code.",
        f"We limit a new code to {P['cap']} sign-ups a day while we check how it is being used. We can lift that limit for promoters we know well.",
    ]),
    ("5. What you earn", [
        f"You earn {P['rate']}% of Wiji's net fee on a payment. Wiji's net fee is the platform fee Wiji keeps from that payment (currently 5% of the payment), minus the fee that Paystack, our payment provider, charges on it. You never earn from sign-ups alone, only when real money is paid.",
        "There are two ways to earn from a person you brought in, and each has its own time limit:",
        f"- When they pay for something in Wiji (a ride, an order, a group subscription): you earn on those payments for {P['payer']} days, counted from the first payment they make.",
        f"- When they are paid through Wiji, for example a driver, a business or a paid-group creator: you earn on those payments for {P['payee']} days, counted from the first payment they receive.",
        "After a time limit ends, you stop earning on that side. Other sides and other people you brought in are not affected.",
        "Example: a person you brought in pays R100 for a ride. Wiji keeps 5% (R5.00). Paystack charges about R2.00 on that payment, so Wiji's net fee is about R3.00 and your 20% is about R0.60. This is an illustration only. Real amounts depend on the payment and on Paystack's fees at the time.",
        "You do not earn on a payment where you are the other person in the payment.",
    ]),
    ("6. When and how you are paid", [
        f"A commission can be paid out {P['hold']} days after the payment it came from. This gives time for refunds and problems to show up. You can see each commission and its status in the app: waiting, ready to pay, paid, being checked or cancelled.",
        f"We pay by bank transfer (EFT) to your South African bank account once at least R{P['minimum']} is ready. Payouts are normally made once a month, and each one shows in the app so you can see it.",
        "You must keep your bank details correct. We are not responsible if money goes to an account you gave us wrongly.",
        "You are responsible for your own tax on what you earn, including declaring it to SARS where required. We may ask you for details we need by law to pay you.",
    ]),
    ("7. Refunds and cancelled commissions", [
        "If a payment is refunded, we cancel the commission on it.",
        "If we already paid you a commission on a payment that is later refunded, we may take that amount off your next payout, or ask you to pay it back.",
        "If a commission is cancelled, we show it in the app as cancelled.",
    ]),
    ("8. Fair play and checks", [
        "We check commissions to keep the programme fair. Some commissions are held for a person on our team to review, for example when the payment was made with a card you have also used on Wiji, or paid into a bank account that looks like yours. A person decides, not a computer on its own, and you can ask us to explain the outcome.",
        "You must not:",
        "- Create fake or duplicate accounts, or pay or use Wiji yourself or through friends or relatives to generate commissions.",
        "- Offer people money, gifts or discounts that Wiji has not agreed to, in exchange for entering your code.",
        "- Spam people, or send messages to people who have not agreed to receive them.",
        "- Use bots, scripts, paid clicks or any trick to push up sign-ups or payments.",
        "If we find any of this, we may cancel the commissions involved, freeze your earnings while we investigate, close your promoter account, and where it is allowed, take back anything we paid. We will tell you what we found and give you a chance to respond first, unless it would put someone at risk or break the law.",
    ]),
    ("9. Advertising and honesty rules", [
        "You must say clearly when you are paid to promote Wiji. Add #ad or #sponsored near the start of each post, video or message where you share your code or link, and say it out loud in videos. This is what South African advertising rules and consumer law expect.",
        "Tell the truth about Wiji. Do not promise people earnings, rides, prices or features we have not promised, do not say Wiji is endorsed by anyone it is not, and do not say you work for Wiji.",
        "Do not target children, and do not promote Wiji in places where it would be unlawful or unwelcome.",
        "Use the Wiji name and logo only the way we show on our website. Do not make look-alike pages or apps, and do not buy online adverts that appear to come from Wiji itself.",
        "Respect people's privacy. Only send direct messages to people who have agreed to hear from you, as POPIA and the law on direct marketing require, and stop when they ask.",
    ]),
    ("10. Pausing, stopping and leaving", [
        "You can stop promoting and close your promoter account at any time. Commissions you have already earned and that have not been cancelled stay payable to you under these terms.",
        "We may pause your earnings (\"freeze\" your account) while we look into a concern. A frozen account does not earn or get paid until we decide, and we will tell you why.",
        "We may end the programme, or end your place in it, by telling you in the app. If we end your place without a breach of these terms, we still pay the commissions you earned before that date, once they have passed the waiting period.",
    ]),
    ("11. Changes to the programme", [
        "We may change the rate, the time limits, the waiting period, the minimum payout or these terms. We will tell you in the app before a change takes effect, and a change applies only to payments made after the date we give.",
        "If you do not agree with a change, you can stop promoting before it takes effect.",
    ]),
    ("12. Your information", [
        "We use the details you give us as a promoter, and the records of the people you bring in and your commissions, as explained in section 13 of the Privacy Policy.",
        "As a promoter you can see limited information about the people who used your code: their Wiji username, the kind of payment, its date and amount, and your commission. You must keep this to yourself and use it only to understand your earnings. Do not share it, publish it, or try to contact people with it.",
    ]),
    ("13. Our responsibility to you", [
        "We run the programme as best we can, but we do not promise it will always be available or that you will earn any particular amount. Earnings depend on what the people you bring in do, and on payments actually being made and kept.",
        "As far as the law allows, Wiji is not responsible for lost earnings, lost opportunities or indirect losses connected with the programme, including problems with Paystack, your bank, or the app being unavailable.",
        "You are responsible for what you say and post when you promote Wiji. If someone makes a claim against Wiji because of something you said or did, you agree to cover the reasonable costs and losses that result, as far as the law allows.",
        "Nothing here takes away rights you have under the Consumer Protection Act or other law that cannot be excluded.",
    ]),
    ("14. Questions and complaints", [
        f"If you have a question or something looks wrong with a commission or payout, email us at {EMAIL}. We aim to reply within 5 working days.",
        "If we cannot resolve it, you may approach the National Consumer Commission, the Consumer Goods and Services Ombud, or a court with jurisdiction. These terms are governed by the law of the Republic of South Africa.",
    ]),
]

PRIVACY_PROMOTER_SECTION = (
    "13. Promoters and referral codes",
    [
        "This section covers the Wiji Promoter Programme. It applies on top of the rest of this policy.",
        "If you apply to be a promoter, we collect: the name, email and details you give us about where you promote and your audience; your promoter code and link; the number of visits to your link and the number of sign-ups; your commissions and payouts; your bank name and account details for payouts, held through Paystack (we show only the bank and last 4 digits); and the notes and decisions of the Wiji team about your application and account.",
        "If you enter a promoter code, we record which promoter's code you used, when, and your Wiji username. That promoter can then see your username, the kind of payment you made or received (for example a ride, an order or a group), its date and amount, and their commission. They do not see your card details, your location, your messages or what you bought. Promoters must keep this information private (see the Promoter Programme Terms).",
        "When someone opens a promoter link, we count the visit. We do not build a profile of visitors from it.",
        "To keep the programme fair, our systems automatically compare the cards and bank accounts used for payments with those of the promoter, to flag suspicious commissions for a person on the Wiji team to review. These checks do not decide anything alone. A person decides.",
        "We keep promoter and commission records for up to 5 years, for tax, accounting, fraud and dispute reasons. If you close your promoter account, we stop collecting new promoter data about you.",
        "You can ask to see, correct or delete your promoter information as set out in section 9, subject to what we must keep by law.",
    ],
)
