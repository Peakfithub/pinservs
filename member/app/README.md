# Turnkey Store

Sells your websites with Stripe. Every buyer gets a member account, and their PDF and ZIP files are waiting in a private download area. You manage everything from an admin dashboard.

- **Shop:** https://pinservs.com/member/ (on GitHub Pages)
- **Store:** checkout, member area and admin dashboard. It runs on Cloudflare Workers (free plan) at `https://turnkey-store.<your-subdomain>.workers.dev`.

## Go live (one-time setup, about 15 minutes)

The **Deploy Turnkey Store** action in the pinservs GitHub repo does the technical work for you. It creates the private file storage and the members database, deploys the store, sets its secrets, and connects the shop's buttons to it. You only need to create two accounts and paste in some keys.

### 1. Cloudflare (free)

1. Sign up at https://dash.cloudflare.com/sign-up.
2. Open **Workers & Pages** once and accept the `workers.dev` subdomain it offers.
3. Open **R2 Object Storage** and click **Get started** to turn it on. It's free up to 10 GB, but Cloudflare asks for a payment method.
4. Copy your **Account ID**. It's shown on the Workers & Pages overview page, in the right-hand column.
5. Create an API token:
   1. Go to **My Profile > API Tokens > Create Token**.
   2. Use the **Edit Cloudflare Workers** template.
   3. Click **Add more** and add the permissions **Account > Workers KV Storage > Edit** and **Account > Workers R2 Storage > Edit**.
   4. Create the token and copy it.

### 2. Stripe

1. Go to **Developers > API keys**.
2. Copy the **Secret key**. Start with `sk_test_...` so you can test first.

### 3. Add the secrets in GitHub

In the pinservs repo, go to **Settings > Secrets and variables > Actions > New repository secret** and add these:

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token from step 1.5 |
| `CLOUDFLARE_ACCOUNT_ID` | the Account ID from step 1.4 |
| `STRIPE_SECRET_KEY` | your Stripe secret key |
| `ADMIN_EMAIL` | the email you'll sign in to the dashboard with |
| `ADMIN_PASSWORD` | your dashboard password (12+ characters) |

The secret that signs member sessions and access links is created automatically on the first deploy.

### 4. Deploy

1. Go to **Actions > Deploy Turnkey Store > Run workflow**.
2. Wait about 2 minutes for it to finish. The summary shows your store address.
3. pinservs.com/member then switches over by itself: the Buy now buttons and Member sign in become live.

### 5. Sign in and upload

1. Go to **https://pinservs.com/member/admin/**. It forwards to your dashboard's sign-in page.
2. Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
3. On the **Files** tab, upload each website's ZIP and PDF guides. Use **Download** to check any file.

### 6. Test, then go live

1. Buy a website from the shop with the card `4242 4242 4242 4242`, any future date and any CVC.
2. Create your password, and check that your files download.
3. To take real payments, change the `STRIPE_SECRET_KEY` secret in GitHub to your `sk_live_...` key.
4. Run the action again.

### Optional: Stripe webhook

The webhook gives buyers access even if they close the tab right after paying.

1. In Stripe, go to **Developers > Webhooks > Add endpoint**.
2. For the endpoint URL, enter `<your store address>/stripe/webhook`.
3. For events, choose `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
4. Add its signing secret as the GitHub secret `STRIPE_WEBHOOK_SECRET`.
5. Run the action again.

## What's inside

**For buyers**

- They pay on Stripe Checkout. The store checks with Stripe that the payment went through, then they create a password.
- **My downloads** lists every website they bought, with its PDF and ZIP files. Buyers never see files for websites they didn't buy.

**For you, the admin dashboard**

| Tab | What it does |
|---|---|
| **Overview** | Revenue, orders, members and files. It also lists anything that needs attention. |
| **Files** | Upload PDF and ZIP files per website (several at once, or drag them in). Download a file to check it, or delete it. Copy each Buy link. |
| **Members** | Give access by email, for example after an accepted offer. Add or remove websites for a member. Create one-time access or password-reset links. Remove a member. |
| **Orders** | Every paid Stripe checkout. |

On phones, every page's menu folds into a hamburger button.

## Security

- **Files.** Files are in a private Cloudflare R2 bucket with no public address. Every download checks the signed-in member and what they bought.
- **Member passwords.** Passwords are stored as salted PBKDF2 hashes. After 10 wrong tries, sign-in is blocked for 15 minutes. Sessions use signed, HttpOnly, Secure cookies.
- **Admin sign-in.** You sign in at `/admin/login` with your admin email and password. Your sign-in lasts 12 hours. After 5 wrong tries, sign-in is blocked for 15 minutes. To change the password, update the `ADMIN_PASSWORD` secret in GitHub and run the action again. That also signs out every admin session.
- **Payments.** Every payment is checked with Stripe on the server. Webhook messages must carry Stripe's signature.
- **Keys.** Keys live only in GitHub and Cloudflare secrets, never in these files. The pinservs repo is public, so never put a key or password in a file.

## Everyday tasks

| Task | How |
|---|---|
| Add files for a website | Dashboard > Files > choose files > **Upload**. Members see them at once. |
| Sell to someone who paid another way | Members > **Add a member**, then **Create access link** and send it to them. |
| A member forgot their password | Members > **Password reset link**, then send it to them. |
| Change prices or add a website | Edit `src/sites.js` (prices in cents: `10000` = $100.00). Commit it, and the action redeploys by itself. |

Files over 95 MB can't go through the dashboard. Upload them in Cloudflare instead: R2 > `turnkey-site-files`, at the path `files/<website id>/<file name>`.

## Deploying by hand (instead of the GitHub action)

```bash
npm install
npx wrangler login
npx wrangler r2 bucket create turnkey-site-files
npx wrangler kv namespace create turnkey-store-data   # paste the id into wrangler.toml
npx wrangler deploy
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put SIGNING_SECRET              # any long random text
```

Then put the store address in `member/store-config.js`.
