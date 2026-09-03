import { e as escape_html, a as ensure_array_like, h as attr_style, s as stringify, c as attr, d as derived } from "../../../chunks/index.js";
import { formatInTimeZone } from "date-fns-tz";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data, form } = $$props;
    let editing = null;
    const forInput = (date) => date ? formatInTimeZone(new Date(date), data.timezone, "yyyy-MM-dd") : "";
    const day = (date) => date ? formatInTimeZone(new Date(date), data.timezone, "d MMM yyyy") : "—";
    const today = derived(() => formatInTimeZone(/* @__PURE__ */ new Date(), data.timezone, "yyyy-MM-dd"));
    $$renderer2.push(`<h1 class="text-xl font-semibold">Projects</h1> <p class="mt-1 max-w-2xl text-sm text-neutral-600">Fees can be agreed in any currency. Everything is converted to euros at a rate you fix, so the
	hourly rate you compare jobs on is always in the money you actually bank.</p> `);
    if (form?.message) {
      $$renderer2.push(`<!--[0--><p class="mt-3 rounded bg-neutral-100 p-2 text-sm text-neutral-700">${escape_html(form.message)}</p>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <table class="mt-4 w-full text-sm"><thead class="text-left text-xs text-neutral-500"><tr><th class="py-1">Project</th><th>Fee</th><th>Worked</th><th>Effective</th><th>Projected</th><th>Status</th><th></th></tr></thead><tbody><!--[-->`);
    const each_array = ensure_array_like(data.projects);
    for (let $$index_2 = 0, $$length = each_array.length; $$index_2 < $$length; $$index_2++) {
      let project = each_array[$$index_2];
      $$renderer2.push(`<tr class="border-t border-neutral-200 align-top"><td class="py-2"><span class="mr-1 inline-block h-2 w-2 rounded-full align-middle"${attr_style(`background:${stringify(project.color)}`)}></span> ${escape_html(project.name)} `);
      if (project.clientName) {
        $$renderer2.push(`<!--[0--><span class="text-xs text-neutral-400">${escape_html(project.clientName)}</span>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> `);
      if (project.deadline) {
        $$renderer2.push(`<!--[0--><span class="block text-xs text-neutral-500">due ${escape_html(day(project.deadline))}</span>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></td><td class="py-2">`);
      if (project.feeFormatted) {
        $$renderer2.push(`<!--[0-->${escape_html(project.feeFormatted)} `);
        if (project.currency !== "EUR") {
          $$renderer2.push("<!--[0-->");
          if (project.feeEur !== null) {
            $$renderer2.push(`<!--[0--><span class="block text-xs text-neutral-500">≈ ${escape_html(project.feeEur.toLocaleString("fr-FR"))} EUR</span> <span class="block text-xs text-neutral-400">@ ${escape_html(project.fxRateToEur)} · ${escape_html(project.fxRateAt)}</span>`);
          } else {
            $$renderer2.push(`<!--[-1--><span class="block text-xs text-amber-700">no rate yet</span>`);
          }
          $$renderer2.push(`<!--]-->`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]-->`);
      } else {
        $$renderer2.push(`<!--[-1-->—`);
      }
      $$renderer2.push(`<!--]--></td><td class="py-2">${escape_html(project.actualHours)}h `);
      if (project.plannedHours > 0) {
        $$renderer2.push(`<!--[0--><span class="block text-xs text-neutral-400">+${escape_html(project.plannedHours)}h planned</span>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> `);
      if (project.overrunHours !== null && project.overrunHours > 0) {
        $$renderer2.push(`<!--[0--><span class="block text-xs text-red-700">${escape_html(project.overrunHours)}h over the ${escape_html(project.agreedHours)}h agreed</span>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></td><td class="py-2">${escape_html(project.effectiveRateEur !== null ? project.effectiveRateEur + " €/h" : "—")}</td><td class="py-2">${escape_html(project.projectedRateEur !== null ? project.projectedRateEur + " €/h" : "—")}</td><td class="py-2 text-xs text-neutral-500">${escape_html(project.status)}</td><td class="py-2 text-right"><button class="text-xs underline">${escape_html(editing === project.projectId ? "close" : "edit")}</button></td></tr> `);
      if (editing === project.projectId) {
        $$renderer2.push(`<!--[0--><tr class="border-t border-neutral-100 bg-neutral-50"><td colspan="7" class="p-3"><form method="POST" action="?/update" class="flex flex-wrap items-end gap-3"><input type="hidden" name="projectId"${attr("value", project.projectId)}/> <label class="block"><span class="text-xs text-neutral-500">Name</span> <input name="name"${attr("value", project.name)} class="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"/></label> <label class="block"><span class="text-xs text-neutral-500">Client</span> <input name="clientName"${attr("value", project.clientName ?? "")} class="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"/></label> <label class="block"><span class="text-xs text-neutral-500">Agreed fee</span> <input name="agreedFee" type="number" step="0.01"${attr("value", project.agreedFee ?? "")} class="mt-1 w-28 rounded border border-neutral-300 px-2 py-1 text-sm"/></label> <label class="block"><span class="text-xs text-neutral-500">Currency</span> <select name="currency" class="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"><!--[-->`);
        const each_array_1 = ensure_array_like(data.currencies);
        for (let $$index = 0, $$length2 = each_array_1.length; $$index < $$length2; $$index++) {
          let code = each_array_1[$$index];
          $$renderer2.option({ value: code, selected: project.currency === code }, ($$renderer3) => {
            $$renderer3.push(`${escape_html(code)}`);
          });
        }
        $$renderer2.push(`<!--]--></select></label> <label class="block"><span class="text-xs text-neutral-500">Agreed hours</span> <input name="agreedHours" type="number" step="0.5"${attr("value", project.agreedHours ?? "")} class="mt-1 w-24 rounded border border-neutral-300 px-2 py-1 text-sm"/></label> <label class="block"><span class="text-xs text-neutral-500">Deadline</span> <input name="deadline" type="date"${attr("value", forInput(project.deadline))} class="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"/></label> <label class="block"><span class="text-xs text-neutral-500">Colour</span> <input name="color" type="color"${attr("value", project.color)} class="mt-1 h-8 w-14 rounded border border-neutral-300"/></label> <label class="block"><span class="text-xs text-neutral-500">Status</span> <select name="status" class="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"><!--[-->`);
        const each_array_2 = ensure_array_like(["active", "waiting", "done", "archived"]);
        for (let $$index_1 = 0, $$length2 = each_array_2.length; $$index_1 < $$length2; $$index_1++) {
          let status = each_array_2[$$index_1];
          $$renderer2.option({ value: status, selected: project.status === status }, ($$renderer3) => {
            $$renderer3.push(`${escape_html(status)}`);
          });
        }
        $$renderer2.push(`<!--]--></select></label> <label class="block"><span class="text-xs text-neutral-500">Rate to EUR (optional)</span> <input name="fxRateToEur" type="number" step="0.000001"${attr("placeholder", project.currency === "EUR" ? "n/a" : "or fetch below")}${attr("value", project.fxRateAt === "entered by hand" ? project.fxRateToEur ?? "" : "")} class="mt-1 w-32 rounded border border-neutral-300 px-2 py-1 text-sm"/></label> <button class="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">Save</button></form> `);
        if (project.currency !== "EUR") {
          $$renderer2.push(`<!--[0--><form method="POST" action="?/refreshRate" class="mt-3 flex flex-wrap items-end gap-2"><input type="hidden" name="projectId"${attr("value", project.projectId)}/> <label class="block"><span class="text-xs text-neutral-500">Rate on date</span> <input name="onDate" type="date"${attr("max", today())} class="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"/></label> <button class="rounded border border-neutral-300 px-3 py-1.5 text-sm">Fetch ECB rate</button> <span class="text-xs text-neutral-500">Leave the date blank for today's. Use your invoice date to freeze the rate the
									books should use.</span></form>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></td></tr>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]-->`);
    }
    $$renderer2.push(`<!--]--></tbody></table> <form method="POST" action="?/create" class="mt-6 flex flex-wrap items-end gap-2"><label class="block"><span class="text-xs text-neutral-500">New project</span> <input name="name" class="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"/></label> <label class="block"><span class="text-xs text-neutral-500">Client</span> <input name="clientName" class="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"/></label> <button class="rounded border border-neutral-300 px-3 py-1.5 text-sm">Add</button></form> <p class="mt-6 max-w-2xl text-xs text-neutral-500">Rates are the European Central Bank's daily reference rates. Expect a percent or two of
	difference from what your bank actually gives you after fees — good enough to judge whether a job
	was worth taking, not a substitute for the figure on your statement.</p>`);
  });
}
export {
  _page as default
};
