import { e as escape_html, c as attr, s as stringify, b as attr_class, a as ensure_array_like, h as attr_style, d as derived } from "../../../chunks/index.js";
import { formatInTimeZone } from "date-fns-tz";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data } = $$props;
    const time = (value) => formatInTimeZone(new Date(value), data.timezone, "HH:mm");
    const overcommitted = derived(() => data.capacity ? data.capacity.committedHours > data.capacity.availableHours : false);
    $$renderer2.push(`<div class="flex items-baseline justify-between"><h1 class="text-xl font-semibold">${escape_html(data.weekIso)}</h1> <span class="text-sm"><a class="underline"${attr("href", `?offset=${stringify(data.offset - 1)}`)}>← previous</a> <a class="ml-3 underline"${attr("href", `?offset=${stringify(data.offset + 1)}`)}>next →</a></span></div> `);
    if (data.capacity) {
      $$renderer2.push(`<!--[0--><p${attr_class(`mt-2 inline-block rounded px-2 py-1 text-sm ${overcommitted() ? "bg-red-50 text-red-800" : "bg-neutral-100 text-neutral-700"}`)}>${escape_html(data.capacity.committedHours)}h committed of ${escape_html(data.capacity.availableHours)}h available `);
      if (overcommitted()) {
        $$renderer2.push(`<!--[0-->— over capacity`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></p>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <div class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-7"><!--[-->`);
    const each_array = ensure_array_like(data.days);
    for (let $$index_1 = 0, $$length = each_array.length; $$index_1 < $$length; $$index_1++) {
      let day = each_array[$$index_1];
      $$renderer2.push(`<div${attr_class(`rounded border p-2 ${day.isToday ? "border-neutral-900" : "border-neutral-200"}`)}><h2 class="text-xs font-medium text-neutral-500">${escape_html(day.label)}</h2> `);
      if (day.blocks.length === 0) {
        $$renderer2.push(`<!--[0--><p class="mt-2 text-xs text-neutral-300">—</p>`);
      } else {
        $$renderer2.push(`<!--[-1--><ul class="mt-2 space-y-1"><!--[-->`);
        const each_array_1 = ensure_array_like(day.blocks);
        for (let $$index = 0, $$length2 = each_array_1.length; $$index < $$length2; $$index++) {
          let block = each_array_1[$$index];
          $$renderer2.push(`<li${attr_class(`rounded border-l-2 bg-neutral-50 p-1.5 text-xs ${block.status === "skipped" ? "opacity-50" : ""}`)}${attr_style(`border-left-color: ${stringify(block.color)}`)}><span class="font-mono text-neutral-500">${escape_html(time(block.start))}</span> <span class="block">${escape_html(block.title)}</span> `);
          if (block.pool === "machine") {
            $$renderer2.push(`<!--[0--><span class="text-neutral-400">unattended</span>`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--></li>`);
        }
        $$renderer2.push(`<!--]--></ul>`);
      }
      $$renderer2.push(`<!--]--></div>`);
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
export {
  _page as default
};
