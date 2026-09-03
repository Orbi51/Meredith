import { e as escape_html, a as ensure_array_like, b as attr_class, c as attr } from "../../chunks/index.js";
import { formatInTimeZone } from "date-fns-tz";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data } = $$props;
    const time = (value) => data.signedIn ? formatInTimeZone(new Date(value), data.timezone, "HH:mm") : "";
    const day = (value) => data.signedIn ? formatInTimeZone(new Date(value), data.timezone, "EEE d MMM") : "";
    if (!data.signedIn) {
      $$renderer2.push(`<!--[0--><h1 class="text-xl font-semibold">Capacity</h1> <p class="mt-2 max-w-lg text-sm text-neutral-600">The calendar is capacity, not a to-do list. Sign in with Google to let the app read your
		appointments and write planned work to its own calendar.</p>`);
    } else {
      $$renderer2.push(`<!--[-1--><div class="flex items-baseline justify-between"><h1 class="text-xl font-semibold">Today</h1> <span class="text-sm text-neutral-500">${escape_html(day(data.now))}</span></div> <p class="mt-1 text-sm text-neutral-600"><strong>${escape_html(data.remainingHours.toFixed(1))}h</strong> left of
		${escape_html(data.committedHours.toFixed(1))}h committed today</p> `);
      if (data.atRisk.length > 0) {
        $$renderer2.push(`<!--[0--><section class="mt-4 rounded bg-red-50 p-3"><h2 class="text-sm font-medium text-red-800">Deadline passed</h2> <ul class="mt-1 space-y-1 text-sm text-red-700"><!--[-->`);
        const each_array = ensure_array_like(data.atRisk);
        for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
          let item = each_array[$$index];
          $$renderer2.push(`<li>${escape_html(item.title)} — was due ${escape_html(day(item.deadline))} ${escape_html(time(item.deadline))}</li>`);
        }
        $$renderer2.push(`<!--]--></ul></section>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> `);
      if (data.blocks.length === 0) {
        $$renderer2.push(`<!--[0--><p class="mt-6 text-sm text-neutral-500">Nothing planned today. <a class="underline" href="/add">Capture a task</a> and the scheduler
			will find room for it.</p>`);
      } else {
        $$renderer2.push(`<!--[-1--><ul class="mt-6 space-y-2"><!--[-->`);
        const each_array_1 = ensure_array_like(data.blocks);
        for (let $$index_2 = 0, $$length = each_array_1.length; $$index_2 < $$length; $$index_2++) {
          let block = each_array_1[$$index_2];
          $$renderer2.push(`<li${attr_class(`rounded border p-3 ${block.id === data.nextBlockId ? "border-neutral-900" : "border-neutral-200"} ${block.status === "skipped" ? "opacity-50" : ""}`)}><div class="flex items-baseline gap-3"><span class="font-mono text-sm text-neutral-500">${escape_html(time(block.start))}–${escape_html(time(block.end))}</span> <span class="text-sm">`);
          if (block.projectName) {
            $$renderer2.push(`<!--[0--><span class="text-neutral-500">[${escape_html(block.projectName)}]</span>`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--> ${escape_html(block.title)}</span> `);
          if (block.pool === "machine") {
            $$renderer2.push(`<!--[0--><span class="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">unattended</span>`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--> `);
          if (block.id === data.nextBlockId) {
            $$renderer2.push(`<!--[0--><span class="ml-auto text-xs font-medium">next up</span>`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--></div> `);
          if (block.status === "planned") {
            $$renderer2.push(`<!--[0--><form method="POST" action="?/confirm" class="mt-2 flex flex-wrap gap-2"><input type="hidden" name="blockId"${attr("value", block.id)}/> <!--[-->`);
            const each_array_2 = ensure_array_like([
              ["as-planned", "as planned"],
              ["more", "+30"],
              ["less", "−30"],
              ["skipped", "didn't happen"]
            ]);
            for (let $$index_1 = 0, $$length2 = each_array_2.length; $$index_1 < $$length2; $$index_1++) {
              let [value, label] = each_array_2[$$index_1];
              $$renderer2.push(`<button name="outcome"${attr("value", value)} class="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100">${escape_html(label)}</button>`);
            }
            $$renderer2.push(`<!--]--></form>`);
          } else {
            $$renderer2.push(`<!--[-1--><p class="mt-1 text-xs text-neutral-500">${escape_html(block.status)}`);
            if (block.status === "skipped") {
              $$renderer2.push(`<!--[0-->— returned to the pool and rescheduled`);
            } else {
              $$renderer2.push("<!--[-1-->");
            }
            $$renderer2.push(`<!--]--></p>`);
          }
          $$renderer2.push(`<!--]--></li>`);
        }
        $$renderer2.push(`<!--]--></ul>`);
      }
      $$renderer2.push(`<!--]-->`);
    }
    $$renderer2.push(`<!--]-->`);
  });
}
export {
  _page as default
};
