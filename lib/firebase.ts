import * as admin from "firebase-admin";

let initialized = false;

function parseServiceAccount(): admin.ServiceAccount {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    throw new Error(
      "Missing FIREBASE_SERVICE_ACCOUNT_JSON. Set it in Vercel Project Settings → Environment Variables.",
    );
  }

  try {
    const parsed = JSON.parse(raw) as admin.ServiceAccount & {
      private_key?: string;
    };
    if (parsed.private_key?.includes("\\n")) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }
    return parsed;
  } catch {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the full service account file contents.",
    );
  }
}

export function getAdmin(): typeof admin {
  if (!initialized) {
    admin.initializeApp({
      credential: admin.credential.cert(parseServiceAccount()),
    });
    initialized = true;
  }
  return admin;
}
