import { redirect } from "@sveltejs/kit";
import { v as getUserByEmail } from "./queries.js";
async function currentUser(event) {
  const session = await event.locals.auth();
  const email = session?.user?.email;
  if (!email) return null;
  return getUserByEmail(email);
}
async function requireUser(event) {
  const user = await currentUser(event);
  if (!user) redirect(303, "/");
  return user;
}
export {
  currentUser as c,
  requireUser as r
};
