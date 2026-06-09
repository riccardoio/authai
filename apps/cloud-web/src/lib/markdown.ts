/**
 * Markdown → HTML rendering for the /docs viewer. Ported from
 * apps/demo-react/src/markdown.ts — same languages, same GFM config,
 * same highlight pipeline. Runs server-side in the Next.js page render;
 * the marked + hljs cost is sub-millisecond per page and the route is
 * dynamic so we don't bother caching the HTML output.
 */

import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import bash from "highlight.js/lib/languages/bash";
import jsonLang from "highlight.js/lib/languages/json";
import sql from "highlight.js/lib/languages/sql";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import xml from "highlight.js/lib/languages/xml";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("jsx", javascript);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("json", jsonLang);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);

let configured = false;

export function renderMarkdown(source: string): string {
  if (!configured) {
    marked.use(
      markedHighlight({
        langPrefix: "hljs language-",
        highlight(code, lang) {
          const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
          try {
            return hljs.highlight(code, { language, ignoreIllegals: true }).value;
          } catch {
            return code;
          }
        },
      }),
    );
    marked.setOptions({ gfm: true, breaks: false });
    configured = true;
  }
  return marked.parse(source) as string;
}

/**
 * Slugify a heading's text content for stable in-page anchor links.
 * Matches the slugify used in the demo-react Docs viewer so links
 * built against either output point at the same anchors.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Inject id="..." attributes on h2 headings so the table of contents
 * can deep-link into a doc. Run after renderMarkdown.
 */
export function addHeadingIds(html: string): string {
  return html.replace(/<h2>(.*?)<\/h2>/g, (_match, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, "");
    return `<h2 id="${slugify(text)}">${inner}</h2>`;
  });
}

/**
 * Pull out h2 headings as table-of-contents entries.
 */
export function extractToc(html: string): Array<{ id: string; text: string }> {
  const entries: Array<{ id: string; text: string }> = [];
  const re = /<h2[^>]*>(.*?)<\/h2>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const text = match[1]!.replace(/<[^>]+>/g, "");
    entries.push({ id: slugify(text), text });
  }
  return entries;
}
