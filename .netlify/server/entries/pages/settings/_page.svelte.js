import { e as escape_html, a as ensure_array_like, c as attr, s as stringify } from "../../../chunks/index.js";
import { formatInTimeZone } from "date-fns-tz";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data, form } = $$props;
    const day = (v) => formatInTimeZone(new Date(v), data.settings.timezone, "EEE d MMM");
    $$renderer2.push(`<h1 class="text-xl font-semibold">Settings</h1> `);
    if (form?.message) {
      $$renderer2.push(`<!--[0--><p class="mt-2 rounded bg-green-50 p-2 text-sm text-green-800">${escape_html(form.message)}</p>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <form method="POST" action="?/saveHours" class="mt-4"><h2 class="font-medium">Working hours</h2> <p class="mt-1 text-sm text-neutral-600">The capacity everything else is measured against. Marking a slot for a kind of work is a
		preference, not a rule — the scheduler will use an unmarked slot rather than miss a deadline.</p> <table class="mt-3 text-sm"><thead class="text-left text-xs text-neutral-500"><tr><th class="py-1 pr-4">Day</th><th class="pr-2">Morning</th><th class="pr-4">Prefer</th><th class="pr-2">Afternoon</th><th>Prefer</th></tr></thead><tbody><!--[-->`);
    const each_array = ensure_array_like(data.days);
    for (let $$index_1 = 0, $$length = each_array.length; $$index_1 < $$length; $$index_1++) {
      let day2 = each_array[$$index_1];
      $$renderer2.push(`<tr class="border-t border-neutral-100"><td class="py-1.5 pr-4">${escape_html(day2.name)}</td><!--[-->`);
      const each_array_1 = ensure_array_like([0, 1]);
      for (let $$index = 0, $$length2 = each_array_1.length; $$index < $$length2; $$index++) {
        let slot = each_array_1[$$index];
        $$renderer2.push(`<td class="py-1.5 pr-2"><input type="time"${attr("name", `d${stringify(day2.dayOfWeek)}-s${stringify(slot)}-start`)}${attr("value", day2.intervals[slot]?.start ?? "")} class="rounded border border-neutral-300 px-1 py-0.5"/> <input type="time"${attr("name", `d${stringify(day2.dayOfWeek)}-s${stringify(slot)}-end`)}${attr("value", day2.intervals[slot]?.end ?? "")} class="rounded border border-neutral-300 px-1 py-0.5"/></td> <td class="py-1.5 pr-4"><select${attr("name", `d${stringify(day2.dayOfWeek)}-s${stringify(slot)}-kind`)} class="rounded border border-neutral-300 px-1 py-0.5 text-xs">`);
        $$renderer2.option({ value: "", selected: !day2.intervals[slot]?.preferredKind }, ($$renderer3) => {
          $$renderer3.push(`any`);
        });
        $$renderer2.option(
          {
            value: "creative",
            selected: day2.intervals[slot]?.preferredKind === "creative"
          },
          ($$renderer3) => {
            $$renderer3.push(`creative`);
          }
        );
        $$renderer2.option(
          {
            value: "admin",
            selected: day2.intervals[slot]?.preferredKind === "admin"
          },
          ($$renderer3) => {
            $$renderer3.push(`admin`);
          }
        );
        $$renderer2.push(`</select></td>`);
      }
      $$renderer2.push(`<!--]--></tr>`);
    }
    $$renderer2.push(`<!--]--></tbody></table> <div class="mt-4 flex flex-wrap items-end gap-4"><label class="block text-sm"><span class="text-xs text-neutral-500">Timezone</span> <input name="timezone"${attr("value", data.settings.timezone)} class="mt-1 rounded border border-neutral-300 px-2 py-1"/></label> <label class="block text-sm"><span class="text-xs text-neutral-500">Planning horizon (days)</span> <input name="horizonDays" type="number" min="1" max="90"${attr("value", data.settings.horizonDays)} class="mt-1 w-24 rounded border border-neutral-300 px-2 py-1"/></label> <button class="rounded bg-neutral-900 px-3 py-2 text-sm text-white">Save and replan</button></div></form> <section class="mt-10"><h2 class="font-medium">Calibration</h2> <p class="mt-1 max-w-2xl text-sm text-neutral-600">How far your estimates are from reality, learned from confirmed blocks. Below five samples the
		multiplier stays at 1.0 — the app will not adjust your estimates on evidence it does not have.</p> <table class="mt-3 text-sm"><thead class="text-left text-xs text-neutral-500"><tr><th class="py-1 pr-6">Kind</th><th class="pr-6">Multiplier</th><th class="pr-6">Samples</th><th>Median actual</th></tr></thead><tbody><!--[-->`);
    const each_array_2 = ensure_array_like(data.calibration);
    for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
      let row = each_array_2[$$index_2];
      $$renderer2.push(`<tr class="border-t border-neutral-100"><td class="py-1.5 pr-6">${escape_html(row.kind)}</td><td class="pr-6">×${escape_html(row.multiplier)} `);
      if (row.sampleCount < 5) {
        $$renderer2.push(`<!--[0--><span class="text-xs text-neutral-400">(not yet applied)</span>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></td><td class="pr-6">${escape_html(row.sampleCount)}</td><td>${escape_html(row.medianActualHours ?? "—")}h</td></tr>`);
    }
    $$renderer2.push(`<!--]--></tbody></table></section> <section class="mt-10"><h2 class="font-medium">Google Calendar</h2> <p class="mt-1 text-sm text-neutral-600">`);
    if (data.settings.targetCalendarId) {
      $$renderer2.push(`<!--[0-->Writing to <code class="text-xs">Planned work</code>. No other calendar is ever written to.`);
    } else {
      $$renderer2.push(`<!--[-1-->Not connected yet — the calendar is created on the first replan.`);
    }
    $$renderer2.push(`<!--]--></p> <a class="mt-2 inline-block text-sm underline" href="/debug/calendar">Run the safety check</a></section> <section class="mt-10"><h2 class="font-medium">Notifications</h2> <p class="mt-1 max-w-2xl text-sm text-neutral-600">Two messages, and no others: a morning brief when something is planned, and an alert when a
		deadline becomes impossible. Nothing is sent because the calendar shuffled — noise is why
		people abandon these tools.</p> `);
    if (!data.pushAvailable) {
      $$renderer2.push(`<!--[0--><p class="mt-2 text-sm text-amber-800">Push is not configured on the server (no VAPID keys).</p>`);
    } else {
      $$renderer2.push(`<!--[1--><p class="mt-2 text-sm text-neutral-500">This browser cannot do web push. On iPhone, add the app to your home screen first.</p>`);
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></section> <section class="mt-10"><h2 class="font-medium">What your time is worth</h2> <p class="mt-1 max-w-2xl text-sm text-neutral-600">Effective and projected hourly rates, in euros whatever the fee was agreed in, live on <a class="underline" href="/projects">the projects page</a> — next to the fee and currency
		they are calculated from. Keeping one table rather than two is why the numbers agree.</p></section> <section class="mt-10 mb-16"><h2 class="font-medium">Recurring admin</h2> <p class="mt-1 max-w-2xl text-sm text-neutral-600">Invoicing at the end of each month, and the URSSAF declaration at the end of the month
		following each quarter. Added as ordinary tasks so they compete for capacity like everything
		else — admin that lives outside the plan is admin that happens at 23:00 on the deadline.</p> <ul class="mt-2 space-y-1 text-sm"><!--[-->`);
    const each_array_3 = ensure_array_like(data.upcomingAdmin);
    for (let $$index_3 = 0, $$length = each_array_3.length; $$index_3 < $$length; $$index_3++) {
      let item = each_array_3[$$index_3];
      $$renderer2.push(`<li><span class="font-mono text-xs text-neutral-500">${escape_html(day(item.deadline))}</span> ${escape_html(item.title)} <span class="text-xs text-neutral-400">${escape_html(item.estimateHours)}h</span></li>`);
    }
    $$renderer2.push(`<!--]--></ul> <form method="POST" action="?/generateAdmin" class="mt-3"><button class="rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100">Add these to my tasks</button></form></section>`);
  });
}
export {
  _page as default
};
