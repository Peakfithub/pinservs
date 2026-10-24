# Turnkey Store

Sells your websites with Stripe. Every buyer gets a member account, and their PDF and ZIP files are waiting in a private download area.

## What's inside

**For buyers**

1. A buyer clicks a Buy link, at `/buy/<website id>`, and pays on Stripe Checkout.
2. Stripe sends them back to `/success`. The store asks Stripe directly whether the payment went through.
3. If it's paid, the buyer becomes a member with access to that website, then creates a password on the spot.
4. In **My downloads** (`/members`), they see every website they bought and its PDF and ZIP files, and can download them any time.
   - A buyer only ever sees files for websites they own.
   - A repeat buyer goes straight to their downloads with the new website added.

**For you, the owner dashboard at `/admin`** (sign in at `/admin/login`)

| Tab | What it does |
|---|---|
| **Overview** | Revenue, orders, members and files stored. It also lists websites that have no files yet and members who haven't set a password. |
| **Files** | Upload PDF and ZIP files for each website (pick several at once or drag them in). Download a file to check it, or delete it. Each website's Buy link is here to copy. |
| **Members** | Give someone access by email: useful for an accepted offer paid outside Stripe. Add or remove websites for any member. Create a one-time **access link** so someone can set or reset their password (it works once, for 72 hours). Remove a member. |
| **Orders** | Every paid Stripe checkout, with the buyer, website and amount. |

## Security

- **Private files.** Files are stored in a private Cloudflare R2 bucket. They have no public address.
- **Download checks.** Every download checks the member's signed-in session and their purchases.
- **Passwords.** Passwords are stored as salted PBKDF2 hashes, never as plain text.
- **Sign-in limits.** Repeated wrong passwords are blocked for 15 minutes.
- **Sessions.** Sessions use signed, HttpOnly, Secure cookies and last 14 days. A password reset signs out older sessions.
- **Purchase links.** A purchase link can only create a password once. It can't take over an account that already has one.
- **Your dashboard.** You sign in at `/admin/login` with your admin email and password.
  - Your sign-in lasts 12 hours, and **Sign out** ends it right away.
  - After 5 wrong tries, sign-in is blocked for 15 minutes.
  - The dashboard only accepts changes sent from the dashboard page itself.
- **Admin password reset.** To change your admin password, run `npx wrangler secret put ADMIN_PASSWORD`. This also signs out every open admin session.
- **Stripe webhook.** Webhook messages must carry Stripe's signature.
- **Secret keys.** Keys live in Cloudflare secrets, never in these files.

## Deploy (about 20 minutes)

You need:

- a Stripe account (start in test mode)
- a free Cloudflare account with R2 turned on once in the dashboard (R2 has a free tier, but Cloudflare asks for a payment method)
- Node.js 18 or newer

```bash
npm install
npx wrangler login

npx wrangler r2 bucket create turnkey-site-files
npx wrangler kv namespace create DATA      # paste the printed id into wrangler.toml

npx wrangler secret put STRIPE_SECRET_KEY  # Stripe > Developers > API keys (sk_test_... first)
npx wrangler secret put SIGNING_SECRET     # any long random text, 32+ characters
npx wrangler secret put ADMIN_PASSWORD     # your admin sign-in password (12+ characters)

npx wrangler deploy                        # prints your store address
```

### Add the Stripe webhook (recommended)

The webhook gives buyers access even if they close the tab right after paying.

1. In Stripe, go to **Developers > Webhooks > Add endpoint**.
2. For the endpoint URL, enter `https://<your store address>/stripe/webhook`.
3. For events, choose `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
4. Copy the signing secret (`whsec_...`), then run:
   ```bash
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

A buyer recorded only by the webhook won't have a password yet. They show up under **Needs attention** on the dashboard. Create an access link for them and send it.

## First run checklist

1. Open `https://<your store address>/admin/login`. Sign in with your `ADMIN_EMAIL` (set in `wrangler.toml`) and your `ADMIN_PASSWORD`.
2. On **Files**, upload each website's ZIP and any PDF guides.
3. Make a test purchase using a Buy link. Pay with the card `4242 4242 4242 4242`, any future date and any CVC.
4. Create your password and confirm the files download.
5. To go live, run `npx wrangler secret put STRIPE_SECRET_KEY` with your `sk_live_...` key. Then add a live-mode webhook the same way.

## Everyday tasks

| Task | How |
|---|---|
| Add files for a website | Dashboard > Files > choose files > **Upload**. Members see them at once. |
| Replace a file | Upload a file with the same name, or delete the old one and upload the new one. |
| Sell to someone who paid another way | Members > **Add a member**, then **Create access link** and send it to them. |
| A member forgot their password | Members > **Password reset link**, then send it to them. |
| Change prices or add a website | Edit `src/sites.js` (prices in cents: `10000` = $100.00), then run `npx wrangler deploy`. |

Files over 95 MB can't go through the dashboard. Upload them in the Cloudflare dashboard instead: R2 > `turnkey-site-files`, at the path `files/<website id>/<file name>`. Only `.pdf` and `.zip` files are served.
