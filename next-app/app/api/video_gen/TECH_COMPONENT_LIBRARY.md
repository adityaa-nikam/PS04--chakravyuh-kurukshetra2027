# Reusable technical illustration library

The library is stored as authored React/SVG components and a typed semantic
catalogue. OpenRouter selects structured `subject_scene` actions; it never
generates executable components, markup, coordinates, or animation code.
The existing storyboard → visual plan → validation → Remotion pipeline remains
responsible for timing and MP4 output.

## Available illustrations

| Prompt subject | Reusable pieces | Teaching motion |
| --- | --- | --- |
| RAG / retrieval augmented generation | Question, book/document collection, search, vector store, language model, answer | Reveal source components; trace stated retrieval/generation connections; highlight each receiving component |
| GraphQL | Browser/client, query, GraphQL network, schema/index, resolver, JSON response | Follow stated request/resolution/response relationships with ordered transfers and stage highlights |
| Book | Open book, chapters/pages, sections, index, reader | Animated page shape; reveal hierarchy and trace stated containment/reading relationships |
| JSON alone | JSON document, objects, arrays, keys, values | Reveal source components and highlight stated structure relationships |
| XML alone | XML document, elements, attributes, text | Reveal source components and highlight stated structure relationships |
| JSON versus XML | Existing shared illustrative record and format panels | Progressive representations, paired field highlights, correspondence connector, syntax comparison |

Existing bridge, photosynthesis and CPU illustrations are retained. A book/JSON
analogy does not replace an established bridge or CPU subject. The title's subject
has priority; scene-local wording selects its components. XML/JSON comparisons
keep their dedicated equivalent-record path.

## Source files

- `tech-catalog.ts`: subject detection, source-matched labels, component mapping,
  and conservative relationship extraction.
- `remotion/TechSymbols.tsx`: `BookSymbol`, `SearchSymbol`, `ModelSymbol`,
  `VectorStoreSymbol`, `GraphQLSymbol`, `CodeDocumentSymbol`, `ResolverSymbol`,
  `PagesSymbol`, and registry-dispatched index/question/answer symbols.
- `visual-graph.ts`: allowed icon/topic vocabulary and existing graph contracts.
- `subject-plan.ts`: deterministic reveals, ordered transfers, and matching stage
  highlights within the existing scene allocation and 16-action limit.
- `visual-actions.ts`: validated choices available to the compact model planner.
- `visual-plan.ts` / `model-visual-plan.ts`: domain, evidence and uncertainty guards.
- `tech-catalog.test.ts`: offline integration and component tests.

All symbols are reusable SVG groups with supplied progress, so they can also be
composed into future authored scenes. No animation library or runtime download was
added. Text remains React text; example values are not fabricated by these icons.

## Prompt-to-video review

Run from `next-app/`. These are **manual commands**; implementation did not execute
live inference or render videos. `explain` loads the existing OpenRouter settings.
Begin with inspection so the actual generated narration and resolved visual plan
can be reviewed before rendering:

```bash
npm run explain -- "Explain RAG to beginners: a question goes to a retriever, the retriever searches documents, documents feed a language model, and the model generates an answer. Show the roles of retrieval and generation with recognizable components." --visual-actions --inspect --output artifacts/videos/rag-library-review/final.mp4

npm run explain -- "Explain GraphQL to beginners using a client, query, schema, resolver and JSON response. Explicitly describe how the request is handled and how the response returns." --visual-actions --inspect --output artifacts/videos/graphql-library-review/final.mp4

npm run explain -- "Explain how a book is organized: a book contains chapters, chapters contain pages, and a reader uses an index." --visual-actions --inspect --output artifacts/videos/book-library-review/final.mp4

npm run explain -- "Explain JSON objects, keys, values and arrays with a small clearly illustrative example." --visual-actions --inspect --output artifacts/videos/json-library-review/final.mp4

npm run explain -- "Explain XML documents, elements, attributes and text with a small clearly illustrative example." --visual-actions --inspect --output artifacts/videos/xml-library-review/final.mp4
```

Each command prints its newly saved receipt. Inspect that receipt and its sibling
`resolved-plan.json`, then use its actual path:

```bash
npm run explain -- --resume artifacts/requests/request-ID/request.json
node app/api/video_gen/inspect-render.mjs artifacts/videos/rag-library-review/final.mp4 artifacts/tests/rag-library-review/frames --progress
ffplay -autoexit artifacts/videos/rag-library-review/final.mp4
```

Replace `request-ID` with the printed receipt ID and use the corresponding video
path for the other examples. Existing complete receipts retain their plans. Use
`--replan --inspect` with a fresh output path to upgrade an older receipt while
preserving its narration. Duration approval stays explicit. Rendering remains
silent; no TTS was added.

## Evidence and current limits

Only title/narration enable a subject or component; visual directions alone cannot
create facts. Source labels are preserved. Directed connections require supported
direct assertions such as “retriever searches documents” or “book contains
chapters”; their labels quote the relationship verb. Nodes mentioned together do
not automatically acquire a connection. Negated, uncertain, reversed/passive or
unrecognized phrasing produces a labeled component overview, not an invented
mechanism. This is intentionally bounded English parsing, not general language
understanding or fact checking. The model may revise narration in a fresh request;
the renderer does not silently rewrite a saved script to fit a template.

Graphs retain the existing maximum of six nodes/eight edges/sixteen actions. All
edges receive transfer intervals; receiving-stage highlights use the remaining
action budget. Text still uses measured `FitText`; actual portrait/landscape
readability and label/connector spacing require manual video review.

Review whether recognizable subjects appear, whether connections match narration,
whether the active component is highlighted at the right time, and whether every
label is readable without overlap. Automated markup tests do not certify a video.

## Extending the collection

Add an authored symbol to `TechSymbols`, register its allowed icon, add source
terms/subject metadata to `tech-catalog`, and expose a typed subject action. Keep
the source/evidence guards and add positive, negative, and real-scene rendering
tests. Existing components (book, search, model, query, resolver, documents) can be
recombined without authoring a new entire video.

```bash
npm run test:tech
```
