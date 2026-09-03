import { e as escape_html, a as ensure_array_like, d as derived } from "../../../chunks/index.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data } = $$props;
    const timeFormat = derived(() => new Intl.DateTimeFormat("fr-FR", {
      timeZone: data.scenario.timezone,
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    }));
    const titleById = derived(() => new Map(data.scenario.tasks.map((t) => [t.id, t.title])));
    $$renderer2.push(`<h1 class="text-xl font-semibold">Scheduler debug</h1> <p class="mt-1 text-sm text-neutral-600">Fixture scenario, all times shown in ${escape_html(data.scenario.timezone)}.</p> <section class="mt-6"><h2 class="font-medium">Blocks (${escape_html(data.output.blocks.length)})</h2> <table class="mt-2 w-full text-sm"><thead class="text-left text-neutral-500"><tr><th class="py-1">Task</th><th>Pool</th><th>Start</th><th>End</th></tr></thead><tbody><!--[-->`);
    const each_array = ensure_array_like(data.output.blocks);
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let block = each_array[$$index];
      $$renderer2.push(`<tr class="border-t border-neutral-200"><td class="py-1">${escape_html(titleById().get(block.taskId) ?? block.taskId)}</td><td class="text-neutral-500">${escape_html(block.pool)}</td><td>${escape_html(timeFormat().format(block.start))}</td><td>${escape_html(timeFormat().format(block.end))}</td></tr>`);
    }
    $$renderer2.push(`<!--]--></tbody></table></section> <section class="mt-6"><h2 class="font-medium">Overcommitment report</h2> `);
    if (data.output.unplaced.length === 0 && data.output.atRisk.length === 0) {
      $$renderer2.push(`<!--[0--><p class="mt-2 text-sm text-neutral-600">Everything fits.</p>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <ul class="mt-2 space-y-1 text-sm"><!--[-->`);
    const each_array_1 = ensure_array_like(data.output.unplaced);
    for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
      let item = each_array_1[$$index_1];
      $$renderer2.push(`<li class="text-red-700">${escape_html(titleById().get(item.taskId) ?? item.taskId)}: ${escape_html(item.hoursShort)}h unplaced (${escape_html(item.reason)})</li>`);
    }
    $$renderer2.push(`<!--]--> <!--[-->`);
    const each_array_2 = ensure_array_like(data.output.atRisk);
    for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
      let item = each_array_2[$$index_2];
      $$renderer2.push(`<li class="text-amber-700">${escape_html(titleById().get(item.taskId) ?? item.taskId)}: ${escape_html(item.slackHours)}h of slack${escape_html(item.scheduledPastDeadline ? " — scheduled past its deadline" : "")}</li>`);
    }
    $$renderer2.push(`<!--]--></ul></section> <section class="mt-6"><h2 class="font-medium">Capacity</h2> <ul class="mt-2 space-y-1 text-sm"><!--[-->`);
    const each_array_3 = ensure_array_like(data.output.capacityUsed);
    for (let $$index_3 = 0, $$length = each_array_3.length; $$index_3 < $$length; $$index_3++) {
      let week = each_array_3[$$index_3];
      $$renderer2.push(`<li>${escape_html(week.weekIso)}: ${escape_html(week.committedHours)}h committed of ${escape_html(week.availableHours)}h available</li>`);
    }
    $$renderer2.push(`<!--]--></ul></section> <details class="mt-6"><summary class="cursor-pointer text-sm text-neutral-500">Raw output</summary> <pre class="mt-2 overflow-x-auto rounded bg-neutral-900 p-3 text-xs text-neutral-100">${escape_html(JSON.stringify(data.output, null, 2))}</pre></details>`);
  });
}
export {
  _page as default
};
