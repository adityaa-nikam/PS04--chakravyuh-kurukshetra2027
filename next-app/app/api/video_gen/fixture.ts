import { explainerScriptSchema, type ExplainerScript } from "./schema";

// Fixed sample content, independent of the requested topic, audience, or duration.
const sampleScript = {
  title: "JSON vs XML: Two Ways to Structure Data",
  targetAudience: "Beginners",
  estimatedDurationSeconds: 45,
  scenes: [
    {
      narration: "How does one application send information another can understand? JSON and XML are two text formats that give data a shared structure.",
      visualDirection: "Show two applications exchanging a document, then reveal JSON and XML labels.",
    },
    {
      narration: "JSON organizes data into objects and arrays, with values such as strings, numbers, and booleans. XML uses named elements and attributes to describe information.",
      visualDirection: "Place a JSON object diagram beside an XML element tree; highlight their structure.",
    },
    {
      narration: "Imagine a book with a title and a price. JSON can store those as properties. XML can represent the same information with title and price elements.",
      visualDirection: "Show one book record represented in both formats, matching its title and price with colors.",
    },
    {
      narration: "Neither format is always better. JSON is common in web APIs; XML remains useful in document workflows and established integrations. Choose what your system needs.",
      visualDirection: "End with a checklist: supported tools, data requirements, and existing integrations.",
    },
  ],
} satisfies ExplainerScript;

export function getExplainerScriptFixture(): ExplainerScript {
  // Parse on each use to validate and return an independent copy.
  return explainerScriptSchema.parse(sampleScript);
}
