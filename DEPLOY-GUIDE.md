# Trex — deploy guide for beginners (start to finish)

You already have: a GitHub repository linked to Netlify, and a Neon account. Follow the parts in order.

## Part 1 — Clean your GitHub repository (3 minutes)
1. Open your repository on github.com.
2. The repository must contain these at its top level: all the .html files, `js` folder, `netlify` folder, `netlify.toml`, `package.json`.
3. If you see folders called `data`, `tests` or `bin`: click each one, click the three dots (top right) > Delete directory > Commit changes. They are not needed online.
4. Upload the newest files: Add file > Upload files > drag the contents of the new zip's `Exchange-platform-project` folder (not the folder itself) > Commit changes.

## Part 2 — Get your database address from Neon (3 minutes)
1. Log in at neon.tech and open your project.
2. Click **Connect** (or "Connection details").
3. Find the switch called **Connection pooling** and turn it **OFF**. This matters.
4. Copy the long text starting with `postgres://`. Keep it for Part 4.

## Part 3 — Create your email sender with Gmail (5 minutes, no domain needed)
1. Create a new Gmail just for Trex (for example trexapp@gmail.com) and log in.
2. Go to myaccount.google.com > Security > turn on **2-Step Verification**.
3. In the search box at the top of that page type **App passwords** and open it.
4. Name it "Trex" > Create. Google shows a 16-letter password. Copy it (spaces are fine).
Limit: Gmail sends up to 500 emails a day. Codes can land in spam the first times, so tell users to check spam.

## Part 4 — Add your settings in Netlify (5 minutes)
1. Log in at netlify.com > click your site > **Site configuration** > **Environment variables**.
2. Click **Add a variable** > "Add a single variable". Add each of these (name on the left, value on the right):
   - DATABASE_URL = the Neon text from Part 2
   - ADMIN_EMAILS = your own email address
   - GMAIL_USER = your Trex Gmail address
   - GMAIL_APP_PASSWORD = the 16-letter password from Part 3
   - PAYSTACK_SECRET_KEY = from Paystack dashboard > Settings > API Keys & Webhooks > Test Secret Key
   - PAYSTACK_BANK = test-bank
3. Click Save after each one.

## Part 5 — Deploy (2 minutes)
1. In Netlify click **Deploys** > **Trigger deploy** > **Clear cache and deploy site**.
2. Wait until it says **Published** (about 1-2 minutes). If it says "Failed", click it, copy the red text and send it to me.

## Part 6 — Tell Paystack where to send news (2 minutes)
1. Paystack dashboard > Settings > API Keys & Webhooks.
2. In **Test Webhook URL** paste: https://YOURSITE.netlify.app/api/paystack/webhook (use your real Netlify address) > Save.

## Part 7 — Check everything works (5 minutes)
1. Open https://YOURSITE.netlify.app/api/health. You must see: "database":"postgres", "auth":"better-auth", "email":"gmail".
2. Open your site > Sign in > use your admin email > enter the code from your email.
3. Open https://YOURSITE.netlify.app/api/authcheck — every line must show "ok":true.
4. Open https://YOURSITE.netlify.app/admin.html — you should see the operations centre.

## Part 8 — Your test-mode run (Paystack test money)
1. Sign up as a vendor with a second email (do the face check).
2. Bond page > choose bank + account number > Save payout account. Press "Show my deposit account".
3. Make a customer account (third email), open a trade with your vendor, then as the vendor press Accept. You are sent to the bond page.
4. In Paystack test mode, send a test transfer to the deposit account number shown, and tell me what happens.

## How the face check works
When someone signs up, the page opens the phone camera and asks for three random moves (for example: turn left, smile, blink). It measures real movement on the live video, so a still photo is rejected. It saves three small pictures and a numeric "fingerprint" of the face. If another account has almost the same fingerprint, the account is marked for review: customers can still trade, vendors cannot publish offers until you click "Clear" on the admin page. If the camera is blocked, the person can upload a selfie instead and that account also goes to review. This is a deterrent, not bank-grade ID verification.
