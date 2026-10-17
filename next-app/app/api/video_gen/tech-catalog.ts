import { graphSchema, type GraphNode } from "./visual-graph";
import type { Storyboard } from "./storyboard";
import type { VisualScene } from "./visual-plan";

type Term = { id: string; pattern: RegExp; icon: GraphNode["icon"] };
const term = (id: string, pattern: RegExp, icon: GraphNode["icon"]): Term => ({ id, pattern, icon });

// This is the reusable library's semantic catalogue. Labels always come from
// narration/title; these patterns never introduce example values or new facts.
export const techCatalog = {
  rag: {
    title: "Retrieval and generation", pattern: /\bRAG\b|\bretrieval[ -]augmented generation\b/i,
    terms: [term("question", /\b(?:question|query|prompt)\b/i, "question"), term("documents", /\b(?:documents?|knowledge base|books?|sources?)\b/i, "book"), term("retriever", /\b(?:retriever|retrieval|search)\b/i, "search"), term("vectors", /\bvector (?:database|store)\b/i, "vector-store"), term("model", /\b(?:language model|LLM|model|generator)\b/i, "model"), term("answer", /\b(?:answer|response)\b/i, "answer")],
  },
  graphql: {
    title: "A GraphQL request", pattern: /\bGraphQL\b/i,
    terms: [term("client", /\bclient\b/i, "browser"), term("query", /\bquery\b/i, "query"), term("api", /\bGraphQL(?: API)?\b/i, "graphql"), term("schema", /\bschema\b/i, "index"), term("resolver", /\bresolvers?\b/i, "resolver"), term("response", /\b(?:JSON|response)\b/i, "json")],
  },
  book: {
    title: "Inside a book", pattern: /\bbooks?\b/i,
    terms: [term("book", /\bbooks?\b/i, "book"), term("chapters", /\bchapters?\b/i, "pages"), term("pages", /\bpages?\b/i, "pages"), term("sections", /\bsections?\b/i, "pages"), term("index", /\b(?:index|table of contents)\b/i, "index"), term("reader", /\breader\b/i, "question")],
  },
  json: {
    title: "Inside JSON", pattern: /\bJSON\b/i,
    terms: [term("json", /\bJSON\b/i, "json"), term("object", /\bobjects?\b/i, "json"), term("array", /\barrays?\b/i, "pages"), term("keys", /\b(?:keys?|properties)\b/i, "query"), term("values", /\bvalues?\b/i, "answer")],
  },
  xml: {
    title: "Inside XML", pattern: /\bXML\b/i,
    terms: [term("xml", /\bXML\b/i, "xml"), term("document", /\bdocument\b/i, "document"), term("elements", /\belements?\b/i, "xml"), term("attributes", /\battributes?\b/i, "query"), term("text", /\btext\b/i, "pages")],
  },
} as const;
export type TechSubject = keyof typeof techCatalog;
export function isTechSubject(value: string): value is TechSubject { return Object.hasOwn(techCatalog, value); }
export function supportsTechSubject(subject: TechSubject, source: string) { return techCatalog[subject].pattern.test(source); }

export function availableTechSubjects(source: string): TechSubject[] {
  // Preserve the dedicated equivalent-record comparison when both formats occur.
  const infrastructure = (["rag", "graphql"] as const).filter(s => supportsTechSubject(s, source));
  if (infrastructure.length) return infrastructure;
  if (/\bJSON\b/i.test(source) && /\bXML\b/i.test(source)) return [];
  return (["json", "xml", "book"] as const).filter(s => supportsTechSubject(s, source));
}

export function sceneTechSubjects(title: string, narration: string): TechSubject[] {
  const titled = availableTechSubjects(title);
  if (titled.length) return titled;
  if (/\bJSON\b/i.test(title) && /\bXML\b/i.test(title)) return [];
  // A passing analogy must not replace the established subject illustration.
  if (/\b(?:bridges?|photosynthesis|CPU|central processing unit)\b/i.test(title)) return [];
  return availableTechSubjects(narration);
}

export function techVisual(scene: Storyboard["scenes"][number], title: string, subject: TechSubject): VisualScene {
  const source = `${title} ${scene.narration}`.replace(/\s+/g, " ");
  if (!supportsTechSubject(subject, source)) throw new Error(`TECH_SUBJECT: ${subject} is absent from the source.`);
  const nodes: GraphNode[] = techCatalog[subject].terms.flatMap(t => {
    // Prefer scene-local wording; the title may supply the subject itself.
    const match = scene.narration.match(t.pattern) ?? title.match(t.pattern);
    return match ? [{ id: t.id, label: match[0], icon: t.icon, role: "item" as const, evidence: match[0] }] : [];
  });
  if (!nodes.length && subject === "rag") {
    const label = source.match(/\bRAG\b/i)![0];
    nodes.push({ id: "rag", label, icon: "search", role: "item", evidence: label });
  }
  const edges: { from: string; to: string; label: string; meaning: "order"; evidence: string }[] = [];
  const clauses = scene.narration.match(/[^.!?;]+[.!?;]?/g) ?? [];
  for (const clause of clauses) {
    if (/\b(?:not|never|no|may|might|could|without)\b|n't\b/i.test(clause)) continue;
    const local = clause.toLowerCase();
    for (const from of nodes) for (const to of nodes) {
      if (from.id === to.id || edges.some(e => e.from === from.id && e.to === to.id)) continue;
      const start = local.indexOf(from.label.toLowerCase());
      const end = local.indexOf(to.label.toLowerCase());
      if (start < 0 || end <= start + from.label.length) continue;
      const between = local.slice(start + from.label.length, end);
      // Bounded direct assertions only. Lists/co-occurrence and reversed or
      // passive statements do not create a directed connection.
      const assertion = between.match(/^\s+(sends?|passes?|provides?|retrieves?|returns?|feeds?|uses?|reads?|searches?|finds?|triggers?|contains?|includes?|requests?|resolves?|produces?|generates?|validates?|stores?|selects?|has|have|holds?|organizes?|wraps?|represents?|is sent to|are sent to|is passed to|are passed to|goes to|feeds into)\s+(?:(?:a|an|the|its|relevant)\s+)?$/i);
      if (!assertion) continue;
      if (edges.length < 8) edges.push({ from: from.id, to: to.id, label: assertion[1], meaning: "order", evidence: clause.trim() });
    }
  }
  const graph = graphSchema.parse({ topic: subject, layout: edges.length ? "sequence" : "overview", nodes, edges });
  return {
    sceneId: scene.id, renderer: "graph", mode: "overview", concept: "diagram",
    heading: techCatalog[subject].title, labels: nodes.slice(0, 3).map(n => n.label),
    note: edges.length ? "Schematic • connections follow the narration" : "Conceptual overview • source components", graph,
  };
}
