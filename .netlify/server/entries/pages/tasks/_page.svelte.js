import { e as escape_html, a as ensure_array_like, c as attr } from "../../../chunks/index.js";
import { formatInTimeZone } from "date-fns-tz";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data, form } = $$props;
    const day = (value) => value ? formatInTimeZone(new Date(value), data.timezone, "EEE d MMM HH:mm") : "—";
    let editing = null;
    function forInput(date) {
      if (!date) return "";
      return formatInTimeZone(new Date(date), data.timezone, "yyyy-MM-dd'T'HH:mm");
    }
    $$renderer2.push(`<div class="flex items-baseline justify-between"><h1 class="text-xl font-semibold">Tasks</h1> <form method="POST" action="?/replan"><button class="text-sm underline hover:text-neutral-900">Replan now</button></form></div> `);
    if (form?.message) {
      $$renderer2.push(`<!--[0--><p class="mt-2 rounded bg-neutral-100 p-2 text-xs text-neutral-700">${escape_html(form.message)}</p>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (data.tasks.length === 0) {
      $$renderer2.push(`<!--[0--><p class="mt-6 text-sm text-neutral-500">Nothing captured yet. <a class="underline" href="/add">Add a task</a>.</p>`);
    } else {
      $$renderer2.push(`<!--[-1--><table class="mt-4 w-full text-sm"><thead class="text-left text-xs text-neutral-500"><tr><th class="py-1">Task</th><th>Estimate</th><th>Planned</th><th>Deadline</th><th>Status</th><th></th></tr></thead><tbody><!--[-->`);
      const each_array = ensure_array_like(data.tasks);
      for (let $$index_4 = 0, $$length = each_array.length; $$index_4 < $$length; $$index_4++) {
        let task = each_array[$$index_4];
        $$renderer2.push(`<tr class="border-t border-neutral-200 align-top"><td class="py-2">`);
        if (task.projectName) {
          $$renderer2.push(`<!--[0--><span class="text-neutral-500">[${escape_html(task.projectName)}]</span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--> ${escape_html(task.title)} <span class="ml-1 text-xs text-neutral-400">${escape_html(task.kind)}</span> `);
        if (task.source === "calendar") {
          $$renderer2.push(`<!--[0--><span class="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800" title="Adopted from your Google Calendar. Its time is fixed there, so the scheduler leaves it alone.">from calendar</span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--> `);
        if (task.waitingReason) {
          $$renderer2.push(`<!--[0--><span class="block text-xs text-amber-700">waiting: ${escape_html(task.waitingReason)}</span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></td><td class="py-2">`);
        if (task.inferred) {
          $$renderer2.push(`<!--[0--><span class="text-neutral-500">${escape_html(task.effectiveHours)}h</span> <span class="block text-xs text-neutral-400">inferred from past work</span>`);
        } else if (task.multiplier !== 1) {
          $$renderer2.push(`<!--[1--><span>${escape_html(task.rawHours)}h</span> <span class="block text-xs text-amber-700">scheduled as ${escape_html(task.effectiveHours)}h (×${escape_html(task.multiplier)})</span>`);
        } else {
          $$renderer2.push(`<!--[-1--><span>${escape_html(task.rawHours)}h</span>`);
        }
        $$renderer2.push(`<!--]--> `);
        if (task.hoursAlreadyDone > 0) {
          $$renderer2.push(`<!--[0--><span class="block text-xs text-neutral-400">${escape_html(task.hoursAlreadyDone)}h done</span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></td><td class="py-2">${escape_html(task.plannedHours)}h `);
        if (task.source === "calendar") {
          $$renderer2.push(`<!--[0--><span class="block text-xs text-neutral-400">fixed in your calendar</span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--> `);
        if (task.source !== "calendar" && task.status !== "waiting" && task.plannedHours + task.hoursAlreadyDone < task.effectiveHours - 0.01) {
          $$renderer2.push(`<!--[0--><span class="block text-xs text-red-700">${escape_html(Math.round((task.effectiveHours - task.plannedHours - task.hoursAlreadyDone) * 100) / 100)}h unplaced</span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></td><td class="py-2">${escape_html(day(task.deadline))}</td><td class="py-2"><form method="POST" action="?/setStatus" class="flex items-center gap-1"><input type="hidden" name="taskId"${attr("value", task.id)}/> <select name="status" class="rounded border border-neutral-300 px-1 py-0.5 text-xs"><!--[-->`);
        const each_array_1 = ensure_array_like(["inbox", "active", "waiting", "done"]);
        for (let $$index = 0, $$length2 = each_array_1.length; $$index < $$length2; $$index++) {
          let status = each_array_1[$$index];
          $$renderer2.option({ value: status, selected: task.status === status }, ($$renderer3) => {
            $$renderer3.push(`${escape_html(status)}`);
          });
        }
        $$renderer2.push(`<!--]--></select></form></td><td class="py-2 text-right">`);
        if (task.source === "calendar") {
          $$renderer2.push(`<!--[0--><form method="POST" action="?/dismiss"><input type="hidden" name="taskId"${attr("value", task.id)}/> <button class="text-xs underline" title="Removes it here only — the calendar event stays">remove</button></form>`);
        } else {
          $$renderer2.push(`<!--[-1--><button class="text-xs underline">${escape_html(editing === task.id ? "close" : "edit")}</button>`);
        }
        $$renderer2.push(`<!--]--></td></tr> `);
        if (editing === task.id) {
          $$renderer2.push(`<!--[0--><tr class="border-t border-neutral-100 bg-neutral-50"><td colspan="6" class="p-3"><form method="POST" action="?/update" class="flex flex-wrap items-end gap-3"><input type="hidden" name="taskId"${attr("value", task.id)}/> <label class="block"><span class="text-xs text-neutral-500">Title</span> <input name="title"${attr("value", task.title)} class="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"/></label> <label class="block"><span class="text-xs text-neutral-500">Estimate (h)</span> <input name="estimateHours" type="number" step="0.25"${attr("value", task.rawHours ?? "")} class="mt-1 w-24 rounded border border-neutral-300 px-2 py-1 text-sm"/></label> <label class="block"><span class="text-xs text-neutral-500">Deadline</span> <input name="deadline" type="datetime-local"${attr("value", forInput(task.deadline))} class="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"/></label> <label class="block"><span class="text-xs text-neutral-500">Project</span> <select name="projectId" class="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm">`);
          $$renderer2.option({ value: "" }, ($$renderer3) => {
            $$renderer3.push(`none`);
          });
          $$renderer2.push(`<!--[-->`);
          const each_array_2 = ensure_array_like(data.projects);
          for (let $$index_1 = 0, $$length2 = each_array_2.length; $$index_1 < $$length2; $$index_1++) {
            let project = each_array_2[$$index_1];
            $$renderer2.option(
              {
                value: project.id,
                selected: task.projectName === project.name
              },
              ($$renderer3) => {
                $$renderer3.push(`${escape_html(project.name)}`);
              }
            );
          }
          $$renderer2.push(`<!--]--></select></label> <label class="block"><span class="text-xs text-neutral-500">Not before</span> <input name="earliestStart" type="datetime-local"${attr("value", forInput(task.earliestStart))} class="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm" title="The scheduler will not place this task before this moment — waiting on an asset, a brief, a delivery."/></label> <label class="block"><span class="text-xs text-neutral-500">Wait for</span> <select name="dependsOnTaskId" class="mt-1 max-w-56 rounded border border-neutral-300 px-2 py-1 text-sm" title="This task will never be placed before the one it waits for has finished.">`);
          $$renderer2.option({ value: "" }, ($$renderer3) => {
            $$renderer3.push(`nothing`);
          });
          $$renderer2.push(`<!--[-->`);
          const each_array_3 = ensure_array_like(data.tasks.filter((other) => other.id !== task.id));
          for (let $$index_2 = 0, $$length2 = each_array_3.length; $$index_2 < $$length2; $$index_2++) {
            let other = each_array_3[$$index_2];
            $$renderer2.option({ value: other.id, selected: task.dependsOnTaskId === other.id }, ($$renderer3) => {
              $$renderer3.push(`${escape_html(other.title)}`);
            });
          }
          $$renderer2.push(`<!--]--></select></label> <label class="block"><span class="text-xs text-neutral-500">Smallest useful block</span> <select name="minBlockMinutes" class="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm" title="A scheduler that chops modelling into 25-minute fragments produces a calendar that looks full and achieves nothing."><!--[-->`);
          const each_array_4 = ensure_array_like([30, 60, 90, 120, 180, 240]);
          for (let $$index_3 = 0, $$length2 = each_array_4.length; $$index_3 < $$length2; $$index_3++) {
            let minutes = each_array_4[$$index_3];
            $$renderer2.option({ value: minutes, selected: task.minBlockMinutes === minutes }, ($$renderer3) => {
              $$renderer3.push(`${escape_html(minutes < 60 ? minutes + " min" : minutes / 60 + "h")}`);
            });
          }
          $$renderer2.push(`<!--]--></select></label> <label class="flex items-center gap-2 pb-1 text-sm"><input type="checkbox" name="splittable"${attr("checked", task.splittable, true)}/> <span title="Unticked, this task needs one unbroken stretch big enough for all of it.">can be split</span></label> <label class="block"><span class="text-xs text-neutral-500">Waiting on</span> <input name="waitingReason"${attr("value", task.waitingReason ?? "")} placeholder="client feedback" class="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"/></label> <button class="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">Save</button></form> <form method="POST" action="?/remove" class="mt-2"><input type="hidden" name="taskId"${attr("value", task.id)}/> <button class="text-xs text-red-700 underline">Delete this task</button></form></td></tr>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]-->`);
      }
      $$renderer2.push(`<!--]--></tbody></table>`);
    }
    $$renderer2.push(`<!--]--> <section class="mt-10"><h2 class="font-medium">Projects</h2> <p class="mt-1 text-sm text-neutral-600">Fees, currencies, agreed hours and hourly rates live on <a class="underline" href="/projects">the projects page</a>.</p> <ul class="mt-2 flex flex-wrap gap-3 text-sm"><!--[-->`);
    const each_array_5 = ensure_array_like(data.projects);
    for (let $$index_5 = 0, $$length = each_array_5.length; $$index_5 < $$length; $$index_5++) {
      let project = each_array_5[$$index_5];
      $$renderer2.push(`<li class="text-neutral-600">${escape_html(project.name)}</li>`);
    }
    $$renderer2.push(`<!--]--></ul></section>`);
  });
}
export {
  _page as default
};
