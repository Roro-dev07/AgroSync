# Messaging setup: WhatsApp handoff, Android phone or Africa's Talking

The currently selected mode is the manual WhatsApp self-chat handoff. Follow
[WHATSAPP-SETUP.md](WHATSAPP-SETUP.md) for that route. It needs no SMS sender ID or
phone gateway app, and the farmer SMS forwarding step is manual.

The existing Broadcast button now submits saved Supabase recipient snapshots through
the local Node server. Provider credentials belong in the private `.env` file. No Supabase
service-role key is needed. Dashboard calculations, styling and layout are unchanged.

## Android phone gateway: send from your existing SIM

This option uses the phone's ordinary SMS service. Recipients see the SIM's mobile
number, so no branded Africa's Talking sender ID is needed. Your SIM must be active,
able to send SMS, and have the necessary carrier credit or SMS allowance. Carrier
and Android sending limits still apply; use small test batches first.

1. Install SMSGate for Android from the official download link at
   https://sms-gate.app/. Grant SMS sending permission. If you select a SIM in the app,
   grant the requested phone/SIM permission as well.
2. Connect the phone and computer to the same trusted Wi-Fi network.
3. In SMSGate's Home tab, enable **Local Server**, then tap **Start Service**.
   Copy the local address and the Local Server authentication credentials it displays.
   The Cloud Server credentials are different and are not used by this integration.
4. Open the existing private `.env` in AgroSync. Android is already selected. Set:

   ```dotenv
   SMS_PROVIDER=android
   SMS_GATEWAY_URL=http://192.168.1.20:8080
   SMS_GATEWAY_USERNAME=the_local_server_username
   SMS_GATEWAY_PASSWORD="the_local_server_password"
   SMS_GATEWAY_SIM=
   ```

   Replace the example address with the phone's address. If the app shows an empty
   username, leave `SMS_GATEWAY_USERNAME` empty. `SMS_GATEWAY_SIM` is optional: use
   slot 1, 2 or 3, or leave it empty for the phone's default SMS SIM. Keep credentials
   in `.env`; do not add them to browser JavaScript or send them in chat. The existing
   Africa's Talking settings can stay in `.env`; they are unused in Android mode.
5. Run the updated `supabase-sms.sql` in Supabase SQL Editor, even if you previously
   ran its Africa's Talking version. It safely upgrades the allowed providers and
   preserves prior jobs/results. This still requires the original database schema,
   administrator access policies and `supabase-broadcast.sql` to be installed.
6. Restart `node serve.cjs` and refresh `http://127.0.0.1:5500/broadcast.html`.
   Sign in and select a region/locality containing only one consenting test recipient.
7. Click **Broadcast message**. Accepted means the phone gateway queued the request;
   check the SMSGate message history and the recipient phone for actual delivery.

The Node server and phone must stay on and connected. Farmers only need normal SMS
reception; they do not need internet. AgroSync's existing Supabase lookups still need
internet on the computer. Use a trusted private network for the local HTTP/Basic
connection and keep the phone's server off the public internet. The backend accepts
only local/private IPv4 gateway addresses and does not follow redirects.

Each submitted batch has a unique gateway message ID; it expires after one hour and
uses normal priority so SMSGate's sending limits remain effective. No fallback SMS
provider is invoked if the phone is offline. The existing uncertain-submission rules
also apply to phone requests: check SMSGate's history before creating a new draft
after a timeout. Switching providers requires a new draft if the old one already has
an SMS job; submissions are never silently replayed through another provider.

References: [Local Server setup](https://docs.sms-gate.app/getting-started/local-server/),
[Sending messages](https://docs.sms-gate.app/features/sending-messages/),
[Message states](https://docs.sms-gate.app/features/status-tracking/).

## Activate your Live application

1. In Supabase SQL Editor, run `supabase-sms.sql` once. The original database schema,
   administrator access policies and `supabase-broadcast.sql` must already be installed.
2. Open the prepared `.env` in the AgroSync folder. If it is missing, copy
   `.env.example` to `.env` first. Put these values in that private file:

   ```dotenv
   SMS_PROVIDER=africastalking
   AT_ENVIRONMENT=live
   AT_USERNAME=agrosync_gh
   AT_API_KEY=your_private_live_api_key
   AT_SENDER_ID=your_approved_sender_id
   ```

   Use the application username, not your login email or account display name. The key
   must belong to that same Live application. Keep `.env` private; it is excluded from
   Git and is blocked by the static server. Environment variables already set in your
   terminal take precedence over `.env`.
3. Stop the current server with Ctrl+C, then run `node serve.cjs` from the AgroSync
   folder. Node 20.12+ is required for `.env` loading; this workspace has Node 24.
4. Open `http://127.0.0.1:5500/broadcast.html`, press Ctrl+F5 and sign in as the existing
   administrator. Readiness is checked when the page loads and before each broadcast.
5. First use a locality containing only your own consenting test recipient. Select
   its region, enter the exact registered locality, type a short message and click
   **Broadcast message**. This action sends real SMS and uses account credit in Live.
6. Check Africa's Talking SMS reports and the recipient's phone. An accepted submission
   is not a confirmed delivery. Check Ghana sender approval and balance if it fails.

PowerShell command to create the private configuration (run once):

```powershell
Set-Location 'C:\Users\YAWSON ROLAND\Desktop\AgroSync'
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env' -ErrorAction Stop
}
notepad .env
```

If `.env` already exists, edit it instead of copying over it.

## Sandbox

Use `AT_ENVIRONMENT=sandbox`, `AT_USERNAME=sandbox`, the Sandbox API key and a test
sender if configured. Results appear in the Africa's Talking simulator. No real
phones receive these messages. A saved broadcast cannot change between Sandbox
and Live after submission activity. Compose a new broadcast with an updated message
when switching modes; reloading retains the current draft request ID.

## Result tracking and retries

- `broadcast_sms_jobs` records the environment and immutable message for each draft.
- `broadcast_sms_deliveries` records each phone, its submission state, provider message
  ID and error code. These tables are readable only by the existing administrator.
- `accepted` means provider acceptance (100/101/102 with a message ID), not handset
  delivery. A public delivery-report callback has not been configured on this local
  server; Africa's Talking reports provide the next delivery check.
- Recipients are claimed atomically in batches of 100. The browser continues batches
  until no pending recipients remain, or an uncertain/in-progress submission needs review.
- Repeated submissions of the same draft skip accepted, failed and uncertain numbers.
  The browser retains its current draft request ID in session storage across reloads.
- A provider timeout, malformed response or interrupted server operation can mean the
  provider accepted an SMS before the connection failed. Those recipients are never
  automatically resent. Interrupted claims become `unknown` after five minutes when
  the same broadcast is checked again. Inspect provider reports before starting a new
  draft to resend anything, since a new draft is a new billable submission.
- Existing `broadcasts` and `broadcast_recipients` remain the original draft/snapshot;
  consult the SMS tracking tables for submission results. No old snapshot is deleted.
- Messages are limited to 1600 characters; long or Unicode messages may use multiple
  billable SMS segments. Failed numbers require review rather than an automatic retry.
- When configuration is missing, the form can still save a draft and says explicitly
  that no SMS was sent.

`node serve.cjs` must keep running. This integration is available through that Node
server, not static-only hosting or opening the HTML file directly. For public hosting,
deploy the Node service with the same private environment variables and HTTPS.

## Verification

Run `node android-sms.test.cjs`, `node broadcast-sms.test.cjs`, `node dashboard.test.cjs` and
`node mofa-advisories.test.cjs`. SMS tests use mocks and send no real messages.
The migration must also be applied and tested against your Supabase project.
The optional `broadcast-sms.sql.test.cjs` validates the migration against a local
PostgreSQL engine using synthetic recipients. It uses PGlite installed in the OS
temporary directory, not an application dependency; `SMS_SQL_TEST_MODULE` can
point to another external installation.

Official references:

- [Africa's Talking SMS Node implementation](https://github.com/AfricasTalkingLtd/africastalking-node.js/blob/master/lib/sms.js)
- [Live and Sandbox endpoint definitions](https://github.com/AfricasTalkingLtd/africastalking-node.js/blob/master/lib/common.js)
- [Ghana sender ID requirements](https://help.africastalking.com/en/articles/11582333-ghana-bulk-sms)
- [Submission status versus delivery reports](https://help.africastalking.com/en/articles/16150386-messaging-error-codes)
