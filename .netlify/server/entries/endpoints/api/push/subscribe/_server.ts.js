import { json } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { b as private_env } from "../../../../../chunks/shared-server.js";
import { c as currentUser } from "../../../../../chunks/auth.js";
import { d as db, p as pushSubscriptions } from "../../../../../chunks/index5.js";
const GET = async () => {
  return json({ publicKey: private_env.VAPID_PUBLIC_KEY ?? null });
};
const POST = async (event) => {
  const user = await currentUser(event);
  if (!user) return json({ error: "signed out" }, { status: 401 });
  const body = await event.request.json();
  if (!body.endpoint || !body.keys?.p256dh || !body.keys.auth) {
    return json({ error: "incomplete subscription" }, { status: 400 });
  }
  await db.insert(pushSubscriptions).values({
    userId: user.id,
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth
  }).onConflictDoNothing({ target: pushSubscriptions.endpoint });
  return json({ ok: true });
};
const DELETE = async (event) => {
  const user = await currentUser(event);
  if (!user) return json({ error: "signed out" }, { status: 401 });
  const { endpoint } = await event.request.json();
  if (endpoint) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  }
  return json({ ok: true });
};
export {
  DELETE,
  GET,
  POST
};
