import { e as escape_html, a as ensure_array_like, c as attr, b as attr_class, f as clsx, d as derived } from "../../../chunks/index.js";
import "@sveltejs/kit/internal";
import "../../../chunks/url.js";
import "../../../chunks/utils2.js";
import "@sveltejs/kit/internal/server";
import "../../../chunks/root.js";
import "../../../chunks/exports.js";
import "../../../chunks/state.svelte.js";
import { formatInTimeZone } from "date-fns-tz";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data, form } = $$props;
    const time = (v) => formatInTimeZone(new Date(v), data.timezone, "HH:mm");
    const day = (v) => formatInTimeZone(new Date(v), data.timezone, "EEE d MMM");
    const dayTime = (v) => formatInTimeZone(new Date(v), data.timezone, "EEE d MMM HH:mm");
    const overrun = derived(() => data.capacity.overrunHours > 0);
    const breaking = derived(() => data.pressure.filter((p) => p.slackHours < 0));
    $$renderer2.push(`<div class="flex items-baseline justify-between"><h1 class="text-xl font-semibold">Weekly plan · ${escape_html(data.currentWeek)}</h1> `);
    if (data.alreadyDoneThisWeek) {
      $$renderer2.push(`<!--[0--><span class="text-sm text-green-700">done for this week</span>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div> <!--[-->`);
    const each_array = ensure_array_like(data.warnings);
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let warning = each_array[$$index];
      $$renderer2.push(`<p class="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-800">${escape_html(warning)}</p>`);
    }
    $$renderer2.push(`<!--]--> <section class="mt-8"><h2 class="font-medium">1 · Last week</h2> <p class="mt-1 text-sm text-neutral-600">`);
    if (data.review.length === 0) {
      $$renderer2.push(`<!--[0-->Nothing was planned last week — nothing to review.`);
    } else {
      $$renderer2.push(`<!--[-1-->${escape_html(data.reviewTotals.planned)}h planned, ${escape_html(data.reviewTotals.actual)}h recorded. `);
      if (data.reviewTotals.unreviewed > 0) {
        $$renderer2.push(`<!--[0--><strong>${escape_html(data.reviewTotals.unreviewed)} still to confirm.</strong> This is what teaches the
				app how long your work really takes.`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]-->`);
    }
    $$renderer2.push(`<!--]--></p> `);
    if (data.review.length > 0) {
      $$renderer2.push(`<!--[0--><ul class="mt-3 space-y-1"><!--[-->`);
      const each_array_1 = ensure_array_like(data.review);
      for (let $$index_2 = 0, $$length = each_array_1.length; $$index_2 < $$length; $$index_2++) {
        let block = each_array_1[$$index_2];
        $$renderer2.push(`<li class="flex flex-wrap items-center gap-2 border-b border-neutral-100 py-1.5 text-sm"><span class="w-40 font-mono text-xs text-neutral-500">${escape_html(day(block.start))} ${escape_html(time(block.start))}</span> <span class="min-w-48 flex-1">${escape_html(block.title)}</span> <span class="text-xs text-neutral-500">${escape_html(block.plannedHours)}h planned</span> `);
        if (block.status === "planned") {
          $$renderer2.push(`<!--[0--><form method="POST" action="?/review" class="flex gap-1"><input type="hidden" name="blockId"${attr("value", block.id)}/> <!--[-->`);
          const each_array_2 = ensure_array_like([
            ["as-planned", "as planned"],
            ["more", "+30"],
            ["less", "−30"],
            ["skipped", "didn't happen"]
          ]);
          for (let $$index_1 = 0, $$length2 = each_array_2.length; $$index_1 < $$length2; $$index_1++) {
            let [value, label] = each_array_2[$$index_1];
            $$renderer2.push(`<button name="outcome"${attr("value", value)} class="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100">${escape_html(label)}</button>`);
          }
          $$renderer2.push(`<!--]--></form>`);
        } else {
          $$renderer2.push(`<!--[-1--><span class="text-xs text-neutral-500">${escape_html(block.status)}`);
          if (block.actualHours !== null) {
            $$renderer2.push(`<!--[0-->· ${escape_html(block.actualHours)}h`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--></span>`);
        }
        $$renderer2.push(`<!--]--></li>`);
      }
      $$renderer2.push(`<!--]--></ul>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></section> <section class="mt-8"><h2 class="font-medium">2 · Already committed</h2> <p class="mt-1 text-sm text-neutral-600">Appointments in your calendar for the rest of this week. Read-only — this is context.</p> `);
    if (data.appointments.length === 0) {
      $$renderer2.push(`<!--[0--><p class="mt-2 text-sm text-neutral-500">Nothing in the calendar.</p>`);
    } else {
      $$renderer2.push(`<!--[-1--><ul class="mt-2 space-y-1 text-sm"><!--[-->`);
      const each_array_3 = ensure_array_like(data.appointments);
      for (let $$index_3 = 0, $$length = each_array_3.length; $$index_3 < $$length; $$index_3++) {
        let appointment = each_array_3[$$index_3];
        $$renderer2.push(`<li class="flex gap-3"><span class="w-40 font-mono text-xs text-neutral-500">${escape_html(day(appointment.start))} `);
        if (!appointment.allDay) {
          $$renderer2.push(`<!--[0-->${escape_html(time(appointment.start))}–${escape_html(time(appointment.end))}`);
        } else {
          $$renderer2.push(`<!--[-1-->all day`);
        }
        $$renderer2.push(`<!--]--></span> <span>${escape_html(appointment.summary)}</span></li>`);
      }
      $$renderer2.push(`<!--]--></ul>`);
    }
    $$renderer2.push(`<!--]--></section> <section class="mt-8"><h2 class="font-medium">3 · What you actually have</h2> <div class="mt-2 flex items-baseline gap-3"><span class="text-4xl font-semibold">${escape_html(data.capacity.availableHours)}h</span> <span class="text-sm text-neutral-600">${escape_html(data.capacity.workingHours)}h of working hours − ${escape_html(data.capacity.appointmentHours)}h of
			appointments</span></div> <p class="mt-1 text-sm text-neutral-500">This is the budget for the rest of this ritual.</p></section> <section class="mt-8"><h2 class="font-medium">4 · Deadline pressure</h2> <p class="mt-1 text-sm text-neutral-600">Every deadline in the next three weeks, least room first. Slack is measured in <em>working</em> hours, not days on a calendar.</p> `);
    if (data.pressure.length === 0) {
      $$renderer2.push(`<!--[0--><p class="mt-2 text-sm text-neutral-500">No deadlines in the next three weeks.</p>`);
    } else {
      $$renderer2.push(`<!--[-1--><table class="mt-3 w-full text-sm"><thead class="text-left text-xs text-neutral-500"><tr><th class="py-1">Task</th><th>Due</th><th>Left to do</th><th>Slack</th></tr></thead><tbody><!--[-->`);
      const each_array_4 = ensure_array_like(data.pressure);
      for (let $$index_4 = 0, $$length = each_array_4.length; $$index_4 < $$length; $$index_4++) {
        let item = each_array_4[$$index_4];
        $$renderer2.push(`<tr${attr_class(`border-t border-neutral-100 ${item.slackHours < 0 ? "bg-red-50" : ""}`)}><td class="py-1.5">`);
        if (item.projectName) {
          $$renderer2.push(`<!--[0--><span class="text-neutral-500">[${escape_html(item.projectName)}]</span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--> ${escape_html(item.title)} `);
        if (item.waiting) {
          $$renderer2.push(`<!--[0--><span class="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">waiting</span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></td><td>${escape_html(dayTime(item.deadline))}</td><td>${escape_html(item.remainingHours)}h `);
        if (item.multiplier !== 1 && item.rawHours !== null) {
          $$renderer2.push(`<!--[0--><span class="block text-xs text-amber-700">you said ${escape_html(item.rawHours)}h (×${escape_html(item.multiplier)})</span>`);
        } else if (item.inferred) {
          $$renderer2.push(`<!--[1--><span class="block text-xs text-neutral-400">inferred</span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></td><td${attr_class(clsx(item.slackHours < 0 ? "font-medium text-red-700" : ""))}>${escape_html(item.slackHours)}h</td></tr>`);
      }
      $$renderer2.push(`<!--]--></tbody></table>`);
    }
    $$renderer2.push(`<!--]--></section> <section class="mt-8"><h2 class="font-medium">5 · Commit</h2> <p class="mt-1 text-sm text-neutral-600">What are you promising to do this week? The total is what matters, not the order.</p> <div${attr_class(`mt-3 rounded p-3 ${overrun() ? "bg-red-50 text-red-900" : "bg-neutral-100 text-neutral-800"}`)}><span class="text-2xl font-semibold">${escape_html(data.capacity.committedHours)}h</span> <span class="text-sm">committed of ${escape_html(data.capacity.availableHours)}h available</span> `);
    if (overrun()) {
      $$renderer2.push(`<!--[0--><strong class="ml-2">— ${escape_html(data.capacity.overrunHours)}h more than you have.</strong> <p class="mt-1 text-sm">Something has to give. Either take work out of this week, move a deadline, or accept that `);
      if (breaking().length > 0) {
        $$renderer2.push(`<!--[0--><strong>${escape_html(breaking().map((b) => b.title).join(", "))}</strong> ${escape_html(breaking().length === 1 ? "slips" : "slip")}.`);
      } else {
        $$renderer2.push(`<!--[-1-->something slips.`);
      }
      $$renderer2.push(`<!--]--></p>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div> <ul class="mt-3 space-y-1"><!--[-->`);
    const each_array_5 = ensure_array_like(data.committable);
    for (let $$index_5 = 0, $$length = each_array_5.length; $$index_5 < $$length; $$index_5++) {
      let task = each_array_5[$$index_5];
      $$renderer2.push(`<li class="flex flex-wrap items-center gap-2 border-b border-neutral-100 py-1.5 text-sm"><form method="POST" action="?/commit"><input type="hidden" name="taskId"${attr("value", task.taskId)}/> <input type="hidden" name="committed"${attr("value", String(!task.committed))}/> <button${attr_class(`rounded border px-2 py-0.5 text-xs ${task.committed ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 hover:bg-neutral-100"}`)}>${escape_html(task.committed ? "committed" : "commit")}</button></form> <span class="min-w-48 flex-1">`);
      if (task.projectName) {
        $$renderer2.push(`<!--[0--><span class="text-neutral-500">[${escape_html(task.projectName)}]</span>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> ${escape_html(task.title)}</span> <span class="text-xs text-neutral-500">${escape_html(task.remainingHours)}h `);
      if (task.multiplier !== 1 && task.rawHours !== null) {
        $$renderer2.push(`<!--[0--><span class="text-amber-700">(you said ${escape_html(task.rawHours)}h)</span>`);
      } else if (task.inferred) {
        $$renderer2.push(`<!--[1--><span class="text-neutral-400">inferred</span>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></span> <span class="w-32 text-right text-xs text-neutral-500">${escape_html(task.deadline ? dayTime(task.deadline) : "no deadline")}</span></li>`);
    }
    $$renderer2.push(`<!--]--></ul></section> <section class="mt-8 mb-16"><h2 class="font-medium">6 · Generate</h2> <p class="mt-1 text-sm text-neutral-600">Nothing is written to your calendar until you have seen the preview and confirmed it.</p> <form method="POST" action="?/preview" class="mt-3 inline-block"><button class="rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100">Preview the plan</button></form> `);
    if (form?.preview) {
      $$renderer2.push(`<!--[0--><div class="mt-4 rounded border border-neutral-200 p-3"><h3 class="text-sm font-medium">${escape_html(form.preview.blocks.length)} blocks</h3> `);
      if (form.preview.atRisk.length > 0) {
        $$renderer2.push(`<!--[0--><div class="mt-2 rounded bg-red-50 p-2 text-sm text-red-800"><strong>At risk:</strong> <ul class="mt-1 space-y-0.5"><!--[-->`);
        const each_array_6 = ensure_array_like(form.preview.atRisk);
        for (let $$index_6 = 0, $$length = each_array_6.length; $$index_6 < $$length; $$index_6++) {
          let risk = each_array_6[$$index_6];
          $$renderer2.push(`<li>${escape_html(risk.title)} — ${escape_html(risk.slackHours)}h slack`);
          if (risk.pastDeadline) {
            $$renderer2.push(`<!--[0-->, scheduled past its
									deadline`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--></li>`);
        }
        $$renderer2.push(`<!--]--></ul></div>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> `);
      if (form.preview.unplaced.length > 0) {
        $$renderer2.push(`<!--[0--><div class="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-800"><strong>Does not fit in the horizon:</strong> <ul class="mt-1 space-y-0.5"><!--[-->`);
        const each_array_7 = ensure_array_like(form.preview.unplaced);
        for (let $$index_7 = 0, $$length = each_array_7.length; $$index_7 < $$length; $$index_7++) {
          let item = each_array_7[$$index_7];
          $$renderer2.push(`<li>${escape_html(item.title)} — ${escape_html(item.hoursShort)}h short (${escape_html(item.reason)})</li>`);
        }
        $$renderer2.push(`<!--]--></ul></div>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> <ul class="mt-3 max-h-72 space-y-0.5 overflow-y-auto text-sm"><!--[-->`);
      const each_array_8 = ensure_array_like(form.preview.blocks);
      for (let $$index_8 = 0, $$length = each_array_8.length; $$index_8 < $$length; $$index_8++) {
        let block = each_array_8[$$index_8];
        $$renderer2.push(`<li class="flex gap-3"><span class="w-40 font-mono text-xs text-neutral-500">${escape_html(block.day)} ${escape_html(block.time)}</span> <span>${escape_html(block.title)}</span> `);
        if (block.pool === "machine") {
          $$renderer2.push(`<!--[0--><span class="text-xs text-neutral-400">unattended</span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></li>`);
      }
      $$renderer2.push(`<!--]--></ul> <form method="POST" action="?/generate" class="mt-4"><button class="rounded bg-neutral-900 px-3 py-2 text-sm text-white">Write these ${escape_html(form.preview.blocks.length)} blocks to my calendar</button></form></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (form?.generated) {
      $$renderer2.push(`<!--[0--><div class="mt-4 rounded bg-green-50 p-3 text-sm text-green-900">Written. ${escape_html(form.generated.blocks)} blocks planned `);
      if (form.generated.calendar) {
        $$renderer2.push(`<!--[0-->· calendar: ${escape_html(form.generated.calendar.inserted)} added,
				${escape_html(form.generated.calendar.updated)} updated,
				${escape_html(form.generated.calendar.removed)} removed`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> <!--[-->`);
      const each_array_9 = ensure_array_like(form.generated.warnings);
      for (let $$index_9 = 0, $$length = each_array_9.length; $$index_9 < $$length; $$index_9++) {
        let warning = each_array_9[$$index_9];
        $$renderer2.push(`<p class="mt-1 text-amber-800">${escape_html(warning)}</p>`);
      }
      $$renderer2.push(`<!--]--></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></section>`);
  });
}
export {
  _page as default
};
