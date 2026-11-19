# Spill the Tank

Anonymous propane price board for Northern Michigan homeowners. The pages are static. Posts go to a small public API backed by a database that is not tied to a personal login on the page.

Visitors get a random handle stored in their own browser. The board does not ask for a name, an email, a photo, or GPS.

## What a post can include

- Supplier, county, town or ZIP, price per gallon, and the date the visitor enters
- Price type: locked-in, will-call, or budget, each kept in its own list
- Owned or leased tank, plus the fee checkboxes the visitor marks
- A short discussion post in one category

Company figures average each price type on its own. They are never combined.

## What this site does not do

- No accounts and no email collection
- No bill, photo, or other file upload
- No voting
- No GPS
- The API does not run inside a personal Google account

## Abuse controls

- Five posts and twenty reports per browser per hour
- A hidden field that catches simple bots
- Length limits
- Phone numbers, email addresses, web addresses, and street addresses in the text are rejected
- Three reports from different browsers hide a post
- Optional: a secret only the site owner holds can hide a post sooner

## Try it on this computer

You do not need a Cloudflare account for this.

```bash
npm install
npm run dev:api
```

In a second terminal:

```bash
npm run dev:web
```

Open http://127.0.0.1:4173 . On localhost the page talks to http://127.0.0.1:8787 even while `config.js` still has the placeholder.

`npm test` checks the posting rules. `npm run test:api` checks the local API while `dev:api` is running.

## Put it on the internet

Do these steps before telling anyone the board is open. The live pages stay disconnected until `config.js` has the real API address.

1. Install Node.js 20 or newer and run `npm install` in this folder.
2. Create a free Cloudflare account at https://dash.cloudflare.com/sign-up . Use whatever login you like. Do not put that email in this repo, in `config.js`, or on the pages.
3. Open the Cloudflare dashboard and go to **Workers & Pages**. Next to **Your subdomain**, choose **Change**. Pick a subdomain that does not include a personal name, an email, or a business name. The public site will contain `https://spill-the-tank.<that-subdomain>.workers.dev`. If the first deploy asks you to choose the subdomain, use the same rule.
4. From this folder run `npx wrangler login` and approve the browser prompt. That login stays on your computer. It is not committed.
5. Create the database:

   ```bash
   npx wrangler d1 create spill-the-tank
   ```

6. Copy the `database_id` from that command into `wrangler.toml`, replacing `00000000-0000-0000-0000-000000000000`. The id is not a password. Do not paste an account email or an API token into the file.
7. Deploy the API:

   ```bash
   npx wrangler deploy
   ```

   The first request creates the tables. You do not run a separate schema command.
8. Copy the `https://spill-the-tank.<subdomain>.workers.dev` URL from the deploy output.
9. Confirm the empty board:

   ```bash
   curl -s https://spill-the-tank.<subdomain>.workers.dev/
   ```

   You should see `{"prices":[],"discussions":[]}`.
10. Edit `config.js`. Set `window.STT_API_URL` to that URL with no trailing slash. Do not put a token in this file.
11. Commit `config.js` and `wrangler.toml`, and push to `main`. The workflow in `.github/workflows/deploy-pages.yml` publishes the static site.
12. Open the published site and post a price. Open the same address in a private window. The price should be there, including county, tank, and date. Locked-in and will-call prices should be in different lists.

Until step 10 is deployed, the published site shows that it does not have a server URL yet and it will not pretend to save a post.

### Hide a post yourself

Reports already hide a post after three different browsers. To hide one yourself:

1. Make a random string at least 32 characters long.
2. Run `npx wrangler secret put MODERATOR_TOKEN` and paste the string when asked. Cloudflare stores it. Do not commit it, and do not put it in `config.js`.
3. Read the board JSON with `curl -s https://spill-the-tank.<subdomain>.workers.dev/` and copy the post `id`.
4. Hide it:

   ```bash
   curl -s -X POST "https://spill-the-tank.<subdomain>.workers.dev/" \
     -H "Content-Type: application/json" \
     -d '{"kind":"hide","id":"POST_ID","token":"YOUR_TOKEN"}'
   ```

A wrong token gets a not-found response.

## Files

- `index.html`, `app.js`, `privacy.html`, `terms.html` are the site
- `config.js` is the only public API address
- `shared/rules.js` is the validation used by both the page and the API
- `worker/src/index.js` is the API
- `wrangler.toml` points the API at the database

The API answers browser preflight (`OPTIONS`) and allows `Content-Type: application/json` from any origin, so the static page can post JSON.
