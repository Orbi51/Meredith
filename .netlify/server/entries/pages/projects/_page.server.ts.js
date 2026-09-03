import { fail } from "@sveltejs/kit";
import { and, eq } from "drizzle-orm";
import { d as db, a as projects } from "../../../chunks/index5.js";
import { r as requireUser } from "../../../chunks/auth.js";
import { p as updateProject, j as createProject, d as getSettings } from "../../../chunks/queries.js";
import { r as rateToEur, i as isSupportedCurrency, p as projectEconomics, C as CURRENCIES } from "../../../chunks/freelance.js";
import { r as replan } from "../../../chunks/planner.js";
const load = async (event) => {
  const user = await requireUser(event);
  const [settings, economics, rows] = await Promise.all([
    getSettings(user.id),
    projectEconomics(user.id),
    db.select().from(projects).where(eq(projects.userId, user.id))
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    currencies: CURRENCIES,
    timezone: settings?.timezone ?? "Europe/Paris",
    // Everything money-related comes from projectEconomics, which is the one
    // place currency conversion happens. Only presentation fields are added.
    projects: economics.map((project) => {
      const row = byId.get(project.projectId);
      return {
        ...project,
        status: row?.status ?? "active",
        deadline: row?.deadline ?? null,
        color: row?.color ?? "#6366f1"
      };
    })
  };
};
const actions = {
  create: async (event) => {
    const user = await requireUser(event);
    const form = await event.request.formData();
    const name = String(form.get("name") ?? "").trim();
    if (!name) return fail(400, { message: "A project needs a name." });
    await createProject(user.id, {
      name,
      clientName: String(form.get("clientName") ?? "").trim() || null
    });
    return { ok: true, message: `Created ${name}.` };
  },
  update: async (event) => {
    const user = await requireUser(event);
    const form = await event.request.formData();
    const projectId = String(form.get("projectId") ?? "");
    const currency = String(form.get("currency") ?? "EUR");
    if (!isSupportedCurrency(currency)) {
      return fail(400, { message: `${currency} is not a currency I have rates for.` });
    }
    const number = (key) => {
      const raw = String(form.get(key) ?? "").trim();
      if (!raw) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };
    const deadlineRaw = String(form.get("deadline") ?? "").trim();
    const deadline = deadlineRaw ? new Date(deadlineRaw) : null;
    const status = String(form.get("status") ?? "active");
    const values = {
      name: String(form.get("name") ?? "").trim() || void 0,
      clientName: String(form.get("clientName") ?? "").trim() || null,
      agreedFee: number("agreedFee"),
      agreedHours: number("agreedHours"),
      currency,
      deadline: deadline && !Number.isNaN(deadline.getTime()) ? deadline : null,
      color: String(form.get("color") ?? "") || void 0,
      status: ["active", "waiting", "done", "archived"].includes(status) ? status : void 0
    };
    const manualRate = number("fxRateToEur");
    if (manualRate !== null && manualRate > 0) {
      values.fxRateToEur = manualRate;
      values.fxRateAt = "entered by hand";
    } else if (currency === "EUR") {
      values.fxRateToEur = 1;
      values.fxRateAt = null;
    }
    await updateProject(user.id, projectId, values);
    try {
      await replan(user.id);
    } catch {
    }
    return { ok: true, message: "Saved." };
  },
  /**
   * Fetch the ECB rate — today's, or the one from a date the user gives.
   * Invoicing in JPY means the rate on the invoice date is the one that
   * belongs in the books.
   */
  refreshRate: async (event) => {
    const user = await requireUser(event);
    const form = await event.request.formData();
    const projectId = String(form.get("projectId") ?? "");
    const onDate = String(form.get("onDate") ?? "").trim() || null;
    const [project] = await db.select().from(projects).where(and(eq(projects.userId, user.id), eq(projects.id, projectId)));
    if (!project) return fail(404, { message: "No such project." });
    if (project.currency === "EUR") {
      return { ok: true, message: "Already in euros — nothing to convert." };
    }
    const rate = await rateToEur(project.currency, onDate);
    if (!rate) {
      return fail(502, {
        message: `Could not fetch a ${project.currency} rate. The fee is kept as it is.`
      });
    }
    await updateProject(user.id, projectId, {
      fxRateToEur: rate.rate,
      fxRateAt: rate.date
    });
    return {
      ok: true,
      message: `1 ${project.currency} = ${rate.rate} EUR (ECB, ${rate.date}).`
    };
  }
};
export {
  actions,
  load
};
