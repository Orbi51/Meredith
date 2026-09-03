import { c as attr, e as escape_html, a as ensure_array_like, b as attr_class, f as clsx } from "../../../../chunks/index.js";
import "@sveltejs/kit/internal";
import "../../../../chunks/url.js";
import "../../../../chunks/utils2.js";
import "@sveltejs/kit/internal/server";
import "../../../../chunks/root.js";
import "../../../../chunks/exports.js";
import "../../../../chunks/state.svelte.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data, form } = $$props;
    let running = false;
    $$renderer2.push(`<h1 class="text-xl font-semibold">Phase 0 acceptance check</h1> <p class="mt-1 max-w-2xl text-sm text-neutral-600">Creates a block on the app's own <code>Planned work</code> calendar, moves it, deletes it, and
	fingerprints every other calendar before and after to prove nothing else was touched. The test
	event is removed at the end.</p> `);
    if (!data.email) {
      $$renderer2.push(`<!--[0--><p class="mt-4 rounded bg-amber-50 p-3 text-sm text-amber-800">Sign in with Google first, using the link in the top right.</p>`);
    } else {
      $$renderer2.push(`<!--[-1--><form method="POST" action="?/verify" class="mt-4"><button class="rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"${attr("disabled", running, true)}>${escape_html("Run the check")}</button> <span class="ml-2 text-sm text-neutral-500">as ${escape_html(data.email)}</span></form>`);
    }
    $$renderer2.push(`<!--]--> `);
    if (form?.steps) {
      $$renderer2.push(`<!--[0--><ul class="mt-6 space-y-2 text-sm"><!--[-->`);
      const each_array = ensure_array_like(form.steps);
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let step = each_array[$$index];
        $$renderer2.push(`<li class="flex gap-2"><span${attr_class(clsx(step.ok ? "text-green-700" : "text-red-700"))}>${escape_html(step.ok ? "✓" : "✗")}</span> <span>${escape_html(step.name)} <span class="block text-xs text-neutral-500">${escape_html(step.detail)}</span></span></li>`);
      }
      $$renderer2.push(`<!--]--></ul> <p${attr_class(`mt-4 rounded p-3 text-sm ${form.passed ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`)}>${escape_html(form.passed ? "Phase 0 threshold met." : "Phase 0 threshold NOT met — see the failing step above.")}</p>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]-->`);
  });
}
export {
  _page as default
};
