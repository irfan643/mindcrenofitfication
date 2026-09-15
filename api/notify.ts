import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAdmin } from "../lib/firebase";
import {
  getAppointment,
  sendNotifyForEvent,
  type NotifyEvent,
} from "../lib/push";

const ALLOWED_EVENTS = new Set<NotifyEvent>([
  "Approved",
  "Completed",
  "Rated",
]);

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-api-key",
  );
}

async function authenticate(
  req: VercelRequest,
): Promise<{ uid: string | null; via: "api_key" | "id_token" | null }> {
  const apiKey = process.env.NOTIFY_API_KEY?.trim();
  const headerKey = String(req.headers["x-api-key"] ?? "").trim();
  if (apiKey && headerKey && headerKey === apiKey) {
    return { uid: null, via: "api_key" };
  }

  const authHeader = String(req.headers.authorization ?? "");
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    return { uid: null, via: null };
  }

  const decoded = await getAdmin().auth().verifyIdToken(match[1]);
  return { uid: decoded.uid, via: "id_token" };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const auth = await authenticate(req);
    if (!auth.via) {
      return res.status(401).json({
        ok: false,
        error:
          "Unauthorized. Send Authorization: Bearer <Firebase ID token> or x-api-key.",
      });
    }

    const body =
      typeof req.body === "string"
        ? (JSON.parse(req.body) as Record<string, unknown>)
        : ((req.body ?? {}) as Record<string, unknown>);

    const event = String(body.event ?? "") as NotifyEvent;
    const appointmentId = String(body.appointmentId ?? "").trim();

    if (!ALLOWED_EVENTS.has(event)) {
      return res.status(400).json({
        ok: false,
        error: 'event must be "Approved", "Completed", or "Rated"',
      });
    }
    if (!appointmentId) {
      return res.status(400).json({
        ok: false,
        error: "appointmentId is required",
      });
    }

    const appointment = await getAppointment(appointmentId);
    if (!appointment) {
      return res.status(404).json({ ok: false, error: "Appointment not found" });
    }

    const patientId = String(appointment.patientId ?? "");
    const doctorId = String(appointment.doctorId ?? "");
    if (!patientId || !doctorId) {
      return res.status(400).json({
        ok: false,
        error: "Appointment missing patientId or doctorId",
      });
    }

    // When using Firebase ID token, enforce role on the appointment.
    if (auth.via === "id_token" && auth.uid) {
      if (event === "Approved" || event === "Completed") {
        if (auth.uid !== doctorId) {
          return res.status(403).json({
            ok: false,
            error: "Only the appointment doctor can trigger this notify.",
          });
        }
      } else if (event === "Rated") {
        if (auth.uid !== patientId) {
          return res.status(403).json({
            ok: false,
            error: "Only the appointment patient can trigger this notify.",
          });
        }
      }
    }

    const result = await sendNotifyForEvent({
      event,
      appointmentId,
      patientId,
      doctorId,
    });

    if (!result.ok) {
      // Soft-fail at HTTP layer so the app status update is not blocked if
      // callers ignore the body — still return 200 with error details.
      return res.status(200).json({
        ok: false,
        softFail: true,
        error: result.error,
        event,
        appointmentId,
      });
    }

    return res.status(200).json({
      ...result,
      event,
      appointmentId,
      patientId,
      doctorId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Notify handler failed";
    console.error("[mindcare-notify]", message, error);
    return res.status(500).json({ ok: false, error: message });
  }
}
