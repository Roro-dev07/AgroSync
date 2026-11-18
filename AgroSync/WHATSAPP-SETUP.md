# Manual WhatsApp self-chat handoff

AgroSync prepares an advisory in your own WhatsApp chat. It does not automatically
send a WhatsApp message or SMS. After sending the note to yourself, copy it from
WhatsApp into the phone's Messages app to send normal SMS to the intended farmers.
Carrier SMS charges and sending limits apply to that manual step.

The existing layout is preserved. In WhatsApp mode, the broadcast button becomes
**Prepare WhatsApp message**. Your number is already stored privately in `.env`:

```dotenv
SMS_PROVIDER=whatsapp
WHATSAPP_SELF_NUMBER=your_own_Ghana_WhatsApp_number
```

No Africa's Talking key, approved sender ID or Android gateway app is needed for this
manual route. Existing provider credentials remain unused. It uses the original
`supabase-broadcast.sql` draft-saving function; no SMS tracking migration is required
solely to prepare a WhatsApp link.

## Use it

1. Stop the old Node server with Ctrl+C, then run `node serve.cjs` from AgroSync.
2. Open `http://127.0.0.1:5500/broadcast.html`, press Ctrl+F5 and sign in.
3. Select the farmers' region and locality, write the advisory and click
   **Prepare WhatsApp message**. The saved draft retains its locality recipient snapshot.
4. Click **Open WhatsApp** in the status message. This direct user click avoids popup
   blockers that can prevent a new tab opened after an asynchronous database save.
5. If prompted, sign in to WhatsApp Web or open WhatsApp on the device. Review your
   self-chat and press **Send**. Opening the link alone does not send the message.
6. On the phone, open that self-chat, copy the advisory text, paste it into Messages,
   select the intended registered farmers and press Send. WhatsApp does not convert
   it to SMS, and AgroSync cannot verify whether you completed these manual steps.

Only the advisory text and your own destination number appear in the WhatsApp link.
Farmer names and phone numbers are not included. The app does not upload the farmers'
registry to WhatsApp. Registered recipient selection is still saved in Supabase; you
must select the correct numbers manually in the phone's Messages app.

Changing the advisory or locality invalidates the prepared link. Prepare it again
after edits. This route never calls either automatic SMS provider and never marks a
draft as delivered merely because a link was prepared or opened.

Your computer and phone need internet for WhatsApp. The farmers receiving the final
SMS do not need internet. On a computer, use WhatsApp Web or the WhatsApp desktop app
signed into the same account as the configured self-chat number.

Official reference: [WhatsApp click-to-chat links and prefilled messages](https://faq.whatsapp.com/5913398998672934).

Tests: `node whatsapp-handoff.test.cjs`, `node broadcast-sms.test.cjs`,
`node android-sms.test.cjs`, `node dashboard.test.cjs`, `node mofa-advisories.test.cjs`.
