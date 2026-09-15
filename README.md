# MindCare Notify API (Vercel)

FCM push sender for appointment events — works on Firebase **Spark** (no Cloud Functions).

Same idea as [Expo custom FCM sending](https://docs.expo.dev/push-notifications/sending-notifications-custom/): the app stores a native device token (`fcmToken`), and this API sends via Firebase Admin → FCM.

## Events

| `event` | Who gets the push | When the app calls it |
|---------|-------------------|------------------------|
| `Approved` | Patient | Doctor accepts appointment |
| `Completed` | Patient (ask for rating) | Doctor marks visit complete |
| `Rated` | Doctor | Patient submits a review |

## 1. One-time Firebase setup

1. Firebase Console → Project settings → **Service accounts** → **Generate new private key**.
2. Enable **Cloud Messaging API (V1)** if not already on.
3. Keep the JSON private (never commit it).

## 2. Deploy to Vercel (manual)

```bash
cd vercel-notify
npm install
npx vercel login
npx vercel
```

When prompted, link/create a Vercel project. Then set env vars:

```bash
npx vercel env add FIREBASE_SERVICE_ACCOUNT_JSON
# Paste the ENTIRE service account JSON (one line is fine)

npx vercel env add NOTIFY_API_KEY
# Optional but recommended for curl tests
```

Production deploy:

```bash
npx vercel --prod
```

Copy the URL, e.g. `https://mindcare-notify-xxx.vercel.app`.

## 3. Configure the Expo app

In the app root `.env`:

```env
EXPO_PUBLIC_NOTIFY_API_URL=https://mindcare-notify-xxx.vercel.app
```

Restart Expo after changing `.env`.

## 4. Test with curl

```bash
curl -X POST "https://YOUR.vercel.app/api/notify" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_NOTIFY_API_KEY" \
  -d "{\"event\":\"Completed\",\"appointmentId\":\"APPOINTMENT_DOC_ID\"}"
```

Or with a Firebase ID token from a logged-in doctor/patient:

```bash
curl -X POST "https://YOUR.vercel.app/api/notify" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer FIREBASE_ID_TOKEN" \
  -d "{\"event\":\"Approved\",\"appointmentId\":\"APPOINTMENT_DOC_ID\"}"
```

## 5. App behavior

- Doctor Approve/Complete → app updates Firestore, then soft-calls this API.
- Patient rates → app saves review, then soft-calls `Rated`.
- If `EXPO_PUBLIC_NOTIFY_API_URL` is missing, the app skips notify (no crash).

## Security

- Prefer Firebase ID tokens from the app (enforced: doctor for Approved/Completed, patient for Rated).
- `x-api-key` is for manual testing only — use a long random value.

## Note on Cloud Functions

`functions/src/index.ts` is the old Firebase Functions version of the Completed push. You can leave it undeployed on Spark; this Vercel API replaces that send path.
