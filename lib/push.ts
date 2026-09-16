import type * as admin from "firebase-admin";
import { getAdmin } from "./firebase";

export type NotifyEvent = "Approved" | "Completed" | "Rated"| "Rejected";

type UserLike = {
  fcmToken?: string;
  notificationsEnabled?: boolean;
  name?: string;
};

type AppointmentLike = {
  patientId?: string;
  doctorId?: string;
  status?: string;
};

export type PushResult =
  | { ok: true; messageId: string }
  | { ok: true; skipped: string }
  | { ok: false; error: string };

async function loadUser(uid: string): Promise<UserLike | null> {
  const snap = await getAdmin().firestore().doc(`users/${uid}`).get();
  if (!snap.exists) return null;
  return snap.data() as UserLike;
}

async function sendToUser(
  uid: string,
  payload: {
    title: string;
    body: string;
    data: Record<string, string>;
    channelId: string;
  },
): Promise<PushResult> {
  const user = await loadUser(uid);
  if (!user) {
    return { ok: true, skipped: "user_not_found" };
  }
  if (user.notificationsEnabled === false) {
    return { ok: true, skipped: "notifications_disabled" };
  }
  const token = user.fcmToken?.trim();
  if (!token) {
    return { ok: true, skipped: "no_fcm_token" };
  }

  try {
    const messageId = await getAdmin().messaging().send({
      token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data,
      android: {
        priority: "high",
        notification: {
          channelId: payload.channelId,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
    });
    return { ok: true, messageId };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "FCM send failed";
    return { ok: false, error: message };
  }
}

export async function getAppointment(
  appointmentId: string,
): Promise<(AppointmentLike & { id: string }) | null> {
  const snap = await getAdmin()
    .firestore()
    .doc(`appointments/${appointmentId}`)
    .get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as AppointmentLike) };
}

/**
 * Approved / Completed → patient
 * Rated → doctor
 */
export async function sendNotifyForEvent(input: {
  event: NotifyEvent;
  appointmentId: string;
  patientId: string;
  doctorId: string;
}): Promise<PushResult> {
  const { event, appointmentId, patientId, doctorId } = input;

  if (event === "Approved") {
    return sendToUser(patientId, {
      title: "Appointment approved",
      body: "Your appointment was approved. Open the app for ticket details.",
      channelId: "appointment-updates",
      data: {
        type: "appointment_approved",
        appointmentId,
        doctorId,
      },
    });
  }
  if (event === "Rejected") {
  const rejectReason =
    (reason || statusMessage || "").trim() ||
    "Your appointment was rejected by the doctor.";
  return sendToUser(patientId, {
    title: "Appointment rejected",
    body: rejectReason,
    channelId: "appointment-updates",
    data: {
      type: "appointment_rejected",
      appointmentId,
      doctorId,
      reason: rejectReason,
    },
  });
}

  if (event === "Completed") {
    return sendToUser(patientId, {
      title: "How was your visit?",
      body: "Tap to rate your doctor and leave a short review.",
      channelId: "review-reminders",
      data: {
        type: "review_request",
        appointmentId,
        doctorId,
      },
    });
  }

  // Rated → notify doctor
  return sendToUser(doctorId, {
    title: "New patient review",
    body: "A patient rated your recent visit. Open reviews to see it.",
    channelId: "appointment-updates",
    data: {
      type: "doctor_rated",
      appointmentId,
      patientId,
      doctorId,
    },
  });
}
