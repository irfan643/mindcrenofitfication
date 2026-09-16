import { getAdmin } from "./firebase";

export type NotifyEvent =
  | "Booked"
  | "Approved"
  | "Completed"
  | "Rated"
  | "Rejected";

type UserLike = {
  fcmToken?: string;
  notificationsEnabled?: boolean;
  name?: string;
};

type AppointmentLike = {
  patientId?: string;
  doctorId?: string;
  status?: string;
  statusMessage?: string | null;
  dateISO?: string;
  time?: string;
};

export type PushResult =
  | { ok: true; messageId: string }
  | { ok: true; skipped: string }
  | { ok: false; error: string };

const DEFAULT_REJECT_REASON =
  "Your appointment was rejected by the doctor.";

async function loadUser(uid: string): Promise<UserLike | null> {
  const snap = await getAdmin().firestore().doc(`users/${uid}`).get();
  if (!snap.exists) return null;
  return snap.data() as UserLike;
}

async function displayName(uid: string, fallback: string): Promise<string> {
  const user = await loadUser(uid);
  const name = user?.name?.trim();
  return name || fallback;
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
  if (!user) return { ok: true, skipped: "user_not_found" };
  if (user.notificationsEnabled === false) {
    return { ok: true, skipped: "notifications_disabled" };
  }
  const token = user.fcmToken?.trim();
  if (!token) return { ok: true, skipped: "no_fcm_token" };

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
        notification: { channelId: payload.channelId },
      },
      apns: {
        payload: { aps: { sound: "default" } },
      },
    });
    return { ok: true, messageId };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "FCM send failed",
    };
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

export async function sendNotifyForEvent(input: {
  event: NotifyEvent;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  reason?: string;
  statusMessage?: string | null;
}): Promise<PushResult> {
  const {
    event,
    appointmentId,
    patientId,
    doctorId,
    reason,
    statusMessage,
  } = input;

  const [patientName, doctorName] = await Promise.all([
    displayName(patientId, "A patient"),
    displayName(doctorId, "your doctor"),
  ]);

  // Patient booked → notify DOCTOR
  if (event === "Booked") {
    return sendToUser(doctorId, {
      title: "New appointment request",
      body: `${patientName} booked an appointment with you. Open the app to review.`,
      channelId: "appointment-updates",
      data: {
        type: "appointment_booked",
        appointmentId,
        patientId,
        doctorId,
        patientName,
      },
    });
  }

  if (event === "Approved") {
    return sendToUser(patientId, {
      title: "Appointment approved",
      body: `Dr. ${doctorName} approved your appointment. Open the app for ticket details.`,
      channelId: "appointment-updates",
      data: {
        type: "appointment_approved",
        appointmentId,
        doctorId,
        doctorName,
      },
    });
  }

  if (event === "Rejected") {
    const rejectReason =
      (reason || statusMessage || "").trim() || DEFAULT_REJECT_REASON;
    return sendToUser(patientId, {
      title: "Appointment rejected",
      body: `Dr. ${doctorName}: ${rejectReason}`,
      channelId: "appointment-updates",
      data: {
        type: "appointment_rejected",
        appointmentId,
        doctorId,
        doctorName,
        reason: rejectReason,
      },
    });
  }

  if (event === "Completed") {
    return sendToUser(patientId, {
      title: "How was your visit?",
      body: `Your visit with Dr. ${doctorName} is marked completed. Tap to leave a review.`,
      channelId: "review-reminders",
      data: {
        type: "review_request",
        appointmentId,
        doctorId,
        doctorName,
      },
    });
  }

  // Rated → doctor
  return sendToUser(doctorId, {
    title: "New patient review",
    body: `${patientName} rated your recent visit. Open reviews to see it.`,
    channelId: "appointment-updates",
    data: {
      type: "doctor_rated",
      appointmentId,
      patientId,
      doctorId,
      patientName,
    },
  });
}
