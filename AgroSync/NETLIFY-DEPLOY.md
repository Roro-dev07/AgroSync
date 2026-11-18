# Deploy AgroSync with its backend on Netlify

The screenshot's error comes from a missing `/api/dashboard` backend. A static
drag-and-drop deployment does not run `node serve.cjs`. Restarting a local server
cannot fix a public Netlify URL. This project now includes two Netlify Functions:

- `/api/dashboard`: the existing Open-Meteo, NASA POWER and SRTM adapters, including
  independent provider errors, genuine source dates and bounded terrain queue time.
- `/api/broadcast-sms`: the existing administrator-only messaging service. The
  selected WhatsApp mode prepares a self-chat link; forwarding as SMS remains manual.

`netlify.toml` builds an explicit browser-asset allowlist into `dist`, and packages
the functions separately. HTML, CSS, the raw Earth image and the recommendation
rules are preserved. `.env`, server source, tests, database SQL and user-supplied
source documents are not placed in the public asset directory.

## Publish to your existing agrosyncgh project

In the VS Code PowerShell terminal:

```powershell
Set-Location 'C:\Users\YAWSON ROLAND\Desktop\AgroSync'
npm.cmd run deploy:netlify
```

The helper reuses the prepared Netlify CLI (or obtains the pinned CLI in the npm cache), opens the normal Netlify
sign-in flow if needed, configures only the selected WhatsApp provider and your own
WhatsApp number from the private `.env`, and deploys the pages **and functions** to
the existing `agrosyncgh` project. Sign in using the account that owns that project.
It does not create an anonymous replacement site or import the entire `.env`.
Your unused Africa's Talking key and Android password are not uploaded by this helper.

Netlify account authorization cannot be supplied by your Supabase login or SMS API key.
The actual live update is complete only after Netlify reports that deployment succeeded.
Open the site URL printed by the CLI, and refresh with Ctrl+F5.

Do not drag only `dist` into Netlify Drop: that publishes pages without the functions.
Do not upload the entire project root as public static assets.

## If deploying from Git instead

Connect the repository to your existing Netlify project. Use:

- Build command: `node build-site.cjs`
- Publish directory: `dist`
- Functions directory: `netlify/functions`
- Node version: `24`

Configure these environment variables in Netlify with **Functions** scope before
deploying. They are runtime settings; a local `.env` does not configure cloud functions.

```dotenv
SMS_PROVIDER=whatsapp
WHATSAPP_SELF_NUMBER=your_own_Ghana_WhatsApp_number
```

The public dashboard requires no API key or Supabase login. Farmer records, registration
and broadcast preparation retain the existing Supabase administrator policies. A new
public domain does not make those records public. Existing password login works through
the configured Supabase project; if you use password-reset or email redirects, add the
new domain to Supabase Auth's allowed redirect URLs.

An Android Local Server on your phone is not reachable from Netlify's cloud network.
Use the configured manual WhatsApp mode online. Changing to automated SMS later requires
the corresponding provider credentials, sender approval and SMS tracking migration.

## Verify the live deployment

1. Open `/api/dashboard?latitude=5.6037&longitude=-0.187` on the deployed domain.
   Expect JSON containing coordinates and source results, rather than HTML or a 404.
   An unavailable upstream is reported honestly; no metric is fabricated.
2. Open the dashboard and select a region, GPS point or Ghana coordinates. Check the
   source/date labels; the first uncached request may take several seconds.
3. Open `/api/broadcast-sms` without signing in. Expect a JSON `401` response.
4. Sign in on the Broadcast page, save an advisory and prepare the WhatsApp link.
   No WhatsApp message or SMS is sent automatically by preparing or opening that link.

Upstream free-service quotas and outages still apply. In-memory caches are reused within
a warm function instance; they are not a shared cache across all Netlify instances.

## Local verification

```powershell
npm.cmd run build
npm.cmd run test:hosting
node dashboard.test.cjs
node whatsapp-handoff.test.cjs
node broadcast-sms.test.cjs
node android-sms.test.cjs
node mofa-advisories.test.cjs
```

Netlify's CLI can also validate the complete bundle without publishing:

```powershell
npx.cmd --yes netlify-cli@27.19.0 build --offline
```

Official references:

- [Netlify Functions project setup](https://docs.netlify.com/build/functions/get-started/)
- [Custom function paths](https://docs.netlify.com/build/functions/configuration/)
- [Deploying files and functions through the CLI](https://cli.netlify.com/commands/deploy/)
