# Direct WhatsApp delivery from AgroSync

The code is implemented, but live delivery needs your Meta business configuration and the new Supabase migration. The existing manual self-chat mode remains active until you explicitly select `whatsapp-cloud`. No API credentials, Meta approvals or live delivery are supplied by this code.

## 1. Install the database migration

In your Supabase project, open SQL Editor, paste the complete contents of `supabase-whatsapp.sql`, and click Run. `supabase-broadcast.sql` must already be installed. The new migration can be run again without deleting farmer records or delivery history.

This adds optional WhatsApp consent fields to `farmers`, plus `broadcast_whatsapp_jobs` and `broadcast_whatsapp_deliveries`. The registered `farmers.phone` value is used as the WhatsApp number. It must actually be the farmer's WhatsApp number. Registration alone does not opt existing farmers in.

New registrations have an optional checkbox for recording the farmer's agreement to receive AgroSync updates. For an existing farmer, **only after they have agreed**, the admin can record that confirmation in SQL Editor:

```sql
update public.farmers
set whatsapp_opt_in = true
where phone = '+233240000001'; -- replace with the farmer's actual registered number
```

The database records the consent timestamp. Changing a farmer's phone number resets permission for that new number. A new agreement must be recorded separately.

## 2. Configure Meta

Use [Meta's WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview/), add your business phone number, and obtain:

- Phone Number ID, not the phone number itself.
- WhatsApp Business Account ID, not the Meta app ID.
- A server access token with access to this account and the `whatsapp_business_messaging` and `whatsapp_business_management` permissions. A temporary testing token is not a durable production credential.
- Your Meta app's App Secret, for authenticating webhook payloads.

Follow Meta's production onboarding, billing and messaging-limit requirements. A test phone number can send only to its permitted test recipients; it is not unrestricted public delivery.

Create a **text-only BODY template**, with positional parameters, named `agrosync_advisory` in English (US), language code `en_US`. Submit the actual template to Meta for approval. Example body:

```text
AgroSync advisory for {{1}}. Field action: {{2}}. Check your plot before acting. Reply STOP to stop these updates.
```

Parameter `{{1}}` receives the selected locality. Parameter `{{2}}` receives the admin-reviewed advisory. Do not add a header, footer component, buttons or other parameters to this integration's template. Use the actual approved name/language in the configuration. Approval and message category are Meta decisions, not guaranteed by this example.

The server checks that this template is approved before claiming recipients. This implementation conservatively caps the **complete rendered body** at 1,024 characters, including static text and locality. It rejects oversized messages before sending; it never silently truncates the recommendation. Use one paragraph without tabs, newlines or runs of four spaces in the advisory parameter.

## 3. Enter private server settings

Add these values to your existing local `.env`, using your real values. Preserve other existing settings. These values must never go in HTML, `supabase-config.js`, public JavaScript, or `dist`.

```dotenv
SMS_PROVIDER=whatsapp-cloud
WHATSAPP_ACCESS_TOKEN=YOUR_META_SERVER_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID=YOUR_PHONE_NUMBER_ID
WHATSAPP_BUSINESS_ACCOUNT_ID=YOUR_WHATSAPP_BUSINESS_ACCOUNT_ID
WHATSAPP_TEMPLATE_NAME=agrosync_advisory
WHATSAPP_TEMPLATE_LANGUAGE=en_US
WHATSAPP_GRAPH_VERSION=v27.0
WHATSAPP_APP_SECRET=YOUR_META_APP_SECRET
WHATSAPP_VERIFY_TOKEN=YOUR_RANDOM_VERIFY_TOKEN_AT_LEAST_24_CHARACTERS
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_LEGACY_SERVICE_ROLE_JWT
```

The **legacy `service_role` JWT** is available in the Supabase project's API key settings. It is not the publishable/anon key. This integration uses it only in the private webhook handler to save signed delivery events and STOP requests; admin-initiated sending continues to use the administrator's own Supabase session and database permissions.

Generate your own webhook verification token locally:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Restart the local server: Ctrl+C, then `node serve.cjs`. Configuration problems appear in the broadcast form; they do not activate a different sending provider automatically.

## 4. Deploy and connect the webhook

The GET verification handshake can be completed before the sender token, template and remaining production settings are ready. Set a private `WHATSAPP_VERIFY_TOKEN` of at least 24 characters in `.env` and run the deployment command below. The helper uploads this token even while `SMS_PROVIDER=whatsapp` keeps manual delivery active. POST receipt/STOP processing remains unavailable until the full server configuration is complete; callback verification alone does not enable live delivery.

The local Node server and the Netlify functions both implement:

```text
/api/broadcast-sms       Administrator-only submission and delivery summaries
/api/whatsapp-webhook    Meta verification, signed delivery receipts and STOP messages
```

For your current public site, the Meta webhook callback URL is:

```text
https://agrosyncgh.netlify.app/api/whatsapp-webhook
```

Publish the updated code and private function settings from your project terminal:

```powershell
npm.cmd run deploy:netlify
```

The deployment helper recognises `SMS_PROVIDER=whatsapp-cloud` and uploads only the selected WhatsApp settings, including its webhook secret and Supabase server key, to Netlify's **functions** environment. It does not import your entire `.env` or upload unused Africa's Talking keys. The public asset build excludes all server modules, SQL and `.env`.

In Meta, enter the callback URL and the exact `WHATSAPP_VERIFY_TOKEN` value. Subscribe the app to the correct WhatsApp Business Account and the `messages` webhook field. Verifying the callback URL alone does not subscribe the business account. The server verifies each POST using the raw body, `X-Hub-Signature-256`, and your App Secret, and accepts events only for the configured account and sender Phone Number ID. [Meta webhook documentation](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/).

The callback needs a public HTTPS address. `localhost` cannot receive Meta's live callbacks without a separately configured public tunnel. Use the deployed endpoint for production receipts and opt-outs.

## 5. Broadcast

1. Generate a recommendation on the dashboard and open Broadcast in the same browser, or enter a message manually.
2. Select the recipient region and locality. The preview shows opted-in WhatsApp recipients and excluded registrations.
3. Review the message and click **Broadcast message**. The server reads the saved database recipient snapshot; the browser does not supply a list of phone numbers to Meta.
4. Keep the page open while eligible recipients are submitted in batches of ten, with at most five Meta requests in flight per batch. Changing the region/locality selects a different audience; the app does not send a point-specific advisory to the whole country automatically.
5. The form polls delivery summaries for approximately one minute; returning focus to the page refreshes tracking for the last submission. Longer-term results remain in Supabase's `broadcast_whatsapp_deliveries` table.

`accepted` means Meta returned a message ID. `sent`, `delivered`, `read` and delivery failures come from signed Meta callbacks. An accepted message is not confirmed handset delivery. `skipped` means permission is missing/withdrawn or the stored farmer/number no longer matches. Recipients without WhatsApp or without connectivity may fail or remain undelivered; WhatsApp does not deliver an SMS fallback.

Replying `STOP`, `UNSUBSCRIBE` or `CANCEL` removes WhatsApp permission and skips pending deliveries. An already submitted/in-flight message cannot be recalled. This handler does not send an automatic opt-out acknowledgement.

Repeated clicks with unchanged content/target/mode reuse the saved broadcast ID. Already claimed recipients are not reclaimed. A network interruption or malformed provider success is recorded as `unknown`; signed callbacks can resolve it. Do not create a new broadcast merely to retry uncertain recipients: inspect the delivery records first. Failed or uncertain deliveries are not automatically resent. If the page closes mid-broadcast, reopen it with the same content/target and resume the same saved request in that browser session; a fresh session may require reviewing the saved job before any new submission.

## Validation

```powershell
node whatsapp-cloud.test.cjs
node whatsapp-cloud.sql.test.cjs
node whatsapp-registration.test.cjs
node recommendation-broadcast.test.cjs
node whatsapp-handoff.test.cjs
node hosting.test.cjs
```

The SQL test uses the optional PGlite installation in the temporary tools directory. Tests use synthetic recipients and mocked Meta calls; they do not send messages or change the live Supabase project.
