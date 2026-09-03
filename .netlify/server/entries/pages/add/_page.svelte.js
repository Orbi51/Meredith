import { c as attr, e as escape_html, a as ensure_array_like } from "../../../chunks/index.js";
import { formatInTimeZone } from "date-fns-tz";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data, form } = $$props;
    function forInput(date) {
      if (!date) return "";
      return formatInTimeZone(new Date(date), data.timezone, "yyyy-MM-dd'T'HH:mm");
    }
    $$renderer2.push(`<h1 class="text-xl font-semibold">Capture</h1> `);
    if (!data.parsed) {
      $$renderer2.push(`<!--[0--><form method="GET" class="mt-4 flex gap-2"><input name="text"${attr("value", data.text)} placeholder="storyboard rev2 Studio X ~6h friday" class="w-full rounded border border-neutral-300 px-3 py-2 text-sm" autofocus=""/> <button class="rounded bg-neutral-900 px-3 py-2 text-sm text-white">Parse</button></form> <p class="mt-2 text-xs text-neutral-500">Type it however you like. Nothing is mandatory — a title on its own is a valid task.</p> <p class="mt-3 text-xs text-neutral-500">For no ambiguity at all, separate the fields with dashes: <code class="rounded bg-neutral-100 px-1">Project - task - time - deadline</code>.
		Order is flexible and any field can be left out. Dashes inside words
		(<code>rev-2</code>, <code>e-mail</code>) are left alone.</p>`);
    } else {
      $$renderer2.push(`<!--[-1--><p class="mt-2 text-sm text-neutral-500">From: <span class="font-mono">${escape_html(data.text)}</span> <a class="ml-2 underline" href="/add">start over</a></p> `);
      if (data.parsed.note) {
        $$renderer2.push(`<!--[0--><p class="mt-3 rounded bg-neutral-100 p-3 text-sm text-neutral-700">${escape_html(data.parsed.note)} <span class="ml-1 text-xs text-neutral-500">(${escape_html(data.parsed.source === "structured" ? "from the dash format — no guessing" : data.parsed.source)})</span></p>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> <form method="POST" action="?/save" class="mt-4 max-w-xl space-y-3"><label class="block"><span class="text-xs text-neutral-500">Title</span> <input name="title"${attr("value", data.parsed.title)} class="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"/></label> <div class="grid grid-cols-2 gap-3"><label class="block"><span class="text-xs text-neutral-500">Estimate (hours)</span> <input name="estimateHours" type="number" step="0.25" min="0"${attr("value", data.parsed.estimateHours ?? "")} placeholder="leave blank to infer" class="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"/></label> <label class="block"><span class="text-xs text-neutral-500">Kind</span> <select name="kind" class="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm">`);
      $$renderer2.option({ value: "creative", selected: data.parsed.kind === "creative" }, ($$renderer3) => {
        $$renderer3.push(`creative (2h blocks)`);
      });
      $$renderer2.option({ value: "admin", selected: data.parsed.kind === "admin" }, ($$renderer3) => {
        $$renderer3.push(`admin (30m blocks)`);
      });
      $$renderer2.option({ value: "machine", selected: data.parsed.kind === "machine" }, ($$renderer3) => {
        $$renderer3.push(`machine (runs unattended)`);
      });
      $$renderer2.push(`</select></label></div> <div class="grid grid-cols-2 gap-3"><label class="block"><span class="text-xs text-neutral-500">Deadline</span> <input name="deadline" type="datetime-local"${attr("value", forInput(data.parsed.deadline))} class="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"/></label> <label class="block"><span class="text-xs text-neutral-500">Project</span> <select name="projectId" class="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm">`);
      $$renderer2.option({ value: "" }, ($$renderer3) => {
        $$renderer3.push(`none`);
      });
      $$renderer2.push(`<!--[-->`);
      const each_array = ensure_array_like(data.projects);
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let project = each_array[$$index];
        $$renderer2.option(
          {
            value: project.id,
            selected: data.parsed.projectId === project.id
          },
          ($$renderer3) => {
            $$renderer3.push(`${escape_html(project.name)}`);
          }
        );
      }
      $$renderer2.push(`<!--]--></select></label></div> `);
      if (data.parsed.unmatchedProjectName) {
        $$renderer2.push(`<!--[0--><label class="flex items-center gap-2 rounded bg-neutral-100 p-3 text-sm"><input type="checkbox" name="createProject"/> <input type="hidden" name="newProjectName"${attr("value", data.parsed.unmatchedProjectName)}/> <span>Create a new project called <strong>${escape_html(data.parsed.unmatchedProjectName)}</strong>?</span></label>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> <label class="block"><span class="text-xs text-neutral-500">Notes</span> <textarea name="notes" rows="2" class="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm">`);
      const $$body = escape_html(data.parsed.notes ?? "");
      if ($$body) {
        $$renderer2.push(`${$$body}`);
      }
      $$renderer2.push(`</textarea></label> `);
      if (form?.message) {
        $$renderer2.push(`<!--[0--><p class="text-sm text-red-700">${escape_html(form.message)}</p>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> <button class="rounded bg-neutral-900 px-3 py-2 text-sm text-white">Save and replan</button></form>`);
    }
    $$renderer2.push(`<!--]-->`);
  });
}
export {
  _page as default
};
