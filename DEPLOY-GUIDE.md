# Trex — production deploy guide (beginner, start to finish)

## Part 1 — Clean your GitHub repository
1. Open your repository on github.com. Its top level must contain: the `.html` files, folders `css`, `js`, `netlify`, plus `netlify.toml` and `package.json`.
2. Delete anything else left over from older versions: `expansion.html`, `launch.html`, `api.rb`, `schema.sql`, `docker-compose.yml`, and the folders `data`, `bin`, `tests`. (Click the file > three dots > Delete file > Commit changes.)
3. Upload the new files: Add file > Upload files > drag in everything inside the zip's `Exchange-platform-project` folder (not the folder itself) > Commit changes.

## Part 2 — Database address (Neon)
1. neon.tech > your project > **Connect**. Turn **Connection pooling OFF** (important). Copy the text starting with `postgres://`.

## Part 3 — Email sender (Gmail)
1. Make a Gmail only for Trex. Turn on 2-Step Verification (myaccount.google.com > Security).
2. Search "App passwords" in that page, create one named Trex, copy the 16 letters.

## Part 4 — Settings in Netlify
Site configuration > Environment variables > Add a variable. Add each (tick "Contains secret values" on the three secret ones):
- DATABASE_URL (secret) = Neon text
- ADMIN_EMAILS = your own email
- GMAIL_USER = your Trex Gmail
- GMAIL_APP_PASSWORD (secret) = the 16 letters
- PAYSTACK_SECRET_KEY (secret) = your LIVE secret key (Paystack > Settings > API Keys & Webhooks)
- PAYSTACK_BANK = access-bank

## Part 5 — Deploy
Deploys > Trigger deploy > **Clear cache and deploy site**. Wait for "Published". If it says "Failed", send me the red text.

## Part 6 — Tell Paystack where to send news
Paystack > Settings > API Keys & Webhooks > **Live Webhook URL**: `https://YOURSITE.netlify.app/api/paystack/webhook` > Save.

## Part 7 — Check everything (this replaces the old step that failed)
1. Open `https://YOURSITE.netlify.app/api/health`. You should see `"database":"postgres"`, `"auth":"better-auth"`, `"email":"gmail"`, `"paystack":true`.
2. On your site click **Create account** and sign up with the email you put in ADMIN_EMAILS (name, email, password, email code, face check).
3. Open `https://YOURSITE.netlify.app/admin.html` > **System check** tab > **Run system check**. Every line must have a green tick. (Opening `/api/authcheck` directly in the address bar also works now after you have signed in.)
   Why the old step failed: typing a link in the address bar does not carry your login. It is fixed in two ways: the site now keeps a secure sign-in cookie, and the System check button sends your login for you.

## Part 8 — Your first real-money test (small amounts!)
1. Make a second account (vendor) and a third (customer) with different emails and faces/selfies. If a face check says "under review", approve it in admin.html > Reviews.
2. Vendor: Become a vendor > fill the profile > publish an offer > Protection (bond) > save payout account > "Show my deposit account".
3. Customer: Trade > pick the offer > request a small trade. Vendor accepts, deposits the shown bond amount to the deposit account, then the trade starts automatically.
4. Finish the trade and check that the bond returns to the vendor's bank. Tell me what you see at each step.

## Face check notes
The face check loads a face-recognition library from the internet (jsdelivr). If it can't load, the user's face check goes to "under review" and you approve it in admin.html > Reviews. To remove the internet dependency later, put the face-api model files in a `models` folder in your repository.
