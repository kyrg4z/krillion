import { unzipSync, strFromU8 } from "fflate";

export type ExtractedSection = { ref: string | null; text: string };

function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[­]/g, "")
    .replace(/-\n(?=[a-z])/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** PDF text arrives hard-wrapped. Rejoin lines that are clearly mid-sentence. */
function dewrap(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) =>
      block
        .split("\n")
        .reduce((acc, line) => {
          const trimmed = line.trim();
          if (!acc) return trimmed;
          const joins = !/[.!?:;]$/.test(acc) && /^[a-z0-9(]/.test(trimmed);
          return joins ? `${acc} ${trimmed}` : `${acc}\n${trimmed}`;
        }, ""),
    )
    .join("\n\n");
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractedSection[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text)];
  return pages
    .map((page, i) => ({ ref: `p. ${i + 1}`, text: dewrap(tidy(page)) }))
    .filter((s) => s.text.length > 40);
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&(#\d+|[a-z]+);/gi, " ");
}

function extractEpub(bytes: Uint8Array): ExtractedSection[] {
  const files = unzipSync(bytes);
  const names = Object.keys(files)
    .filter((n) => /\.(x?html|htm)$/i.test(n))
    .sort();
  const sections: ExtractedSection[] = [];
  for (const name of names) {
    const raw = strFromU8(files[name]);
    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? raw.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
    const label = titleMatch ? tidy(stripHtml(titleMatch[1])).slice(0, 60) : null;
    const text = tidy(stripHtml(raw));
    if (text.length > 120) sections.push({ ref: label || name.split("/").pop() || null, text });
  }
  return sections;
}

/** Turns an uploaded file into labelled sections. Pure local parsing, no network. */
export async function extractSections(
  filename: string,
  bytes: Uint8Array,
): Promise<{ kind: string; sections: ExtractedSection[] }> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return { kind: "pdf", sections: await extractPdf(bytes) };
  if (ext === "epub") return { kind: "epub", sections: extractEpub(bytes) };
  if (ext === "md" || ext === "markdown") {
    const text = tidy(strFromU8(bytes));
    const parts = text.split(/\n(?=#{1,3}\s)/);
    return {
      kind: "markdown",
      sections: parts
        .map((part) => {
          const heading = part.match(/^#{1,3}\s+(.+)/);
          return { ref: heading ? heading[1].trim().slice(0, 60) : null, text: tidy(part) };
        })
        .filter((s) => s.text.length > 60),
    };
  }
  const text = tidy(strFromU8(bytes));
  return { kind: ext === "txt" ? "text" : "notes", sections: text ? [{ ref: null, text }] : [] };
}
