/**
 * Technical terminology pronunciation and spoken phrasing normalizer for TTS narration.
 * Transforms technical symbols, Big-O notation, code identifiers, and CS acronyms
 * into natural spoken equivalents while preserving factual meaning.
 */

interface ReplacementRule {
  pattern: RegExp;
  replacement: string | ((substring: string, ...args: string[]) => string);
}

const PRONUNCIATION_RULES: ReplacementRule[] = [
  // 1. Complexity & Big-O Notation
  { pattern: /\bBig\s*O\b/gi, replacement: "Big-O" },
  { pattern: /\bO\(1\)/gi, replacement: "O of 1" },
  { pattern: /\bO\(log\s*n\)/gi, replacement: "O of log n" },
  { pattern: /\bO\(n\s*log\s*n\)/gi, replacement: "O of n log n" },
  { pattern: /\bO\(n\^2\)/gi, replacement: "O of n squared" },
  { pattern: /\bO\(2\^n\)/gi, replacement: "O of 2 to the n" },
  { pattern: /\bO\(n\)/gi, replacement: "O of n" },
  { pattern: /\bO\(([^)]+)\)/gi, replacement: (_match, p1) => `O of ${p1}` },

  // 2. Math & Array Expressions in spoken context
  { pattern: /⌊\s*([^⌋]+)\s*⌋/g, replacement: (_match, p1) => `${p1} rounded down` },
  { pattern: /\barr\[(\w+)\]/g, replacement: (_match, p1) => `array at ${p1}` },
  { pattern: /\[(\d+)\.\.(\d+)\]/g, replacement: (_match, p1, p2) => `${p1} through ${p2}` },
  { pattern: /\s*===?\s*/g, replacement: " equals " },
  { pattern: /\s*!==?\s*/g, replacement: " does not equal " },
  { pattern: /\s*(?:->|→)\s*/g, replacement: ", which gives, " },

  // 3. Technical Acronyms (Clarify pronunciation without spelling out common words)
  { pattern: /\bSQL\b/g, replacement: "Sequel" },
  { pattern: /\bNoSQL\b/gi, replacement: "No-Sequel" },
  { pattern: /\bPostgreSQL\b/gi, replacement: "Postgres-Q-L" },
  { pattern: /\bPostgres\b/gi, replacement: "Postgres" },
  { pattern: /\bAPI\b/g, replacement: "A-P-I" },
  { pattern: /\bAPIs\b/g, replacement: "A-P-Is" },
  { pattern: /\bJSON\b/g, replacement: "J-S-O-N" },
  { pattern: /\bXML\b/g, replacement: "X-M-L" },
  { pattern: /\bHTML\b/g, replacement: "H-T-M-L" },
  { pattern: /\bCSS\b/g, replacement: "C-S-S" },
  { pattern: /\bHTTP\b/g, replacement: "H-T-T-P" },
  { pattern: /\bHTTPS\b/g, replacement: "H-T-T-P-S" },
  { pattern: /\bURL\b/g, replacement: "U-R-L" },
  { pattern: /\bURLs\b/g, replacement: "U-R-Ls" },
  { pattern: /\bURI\b/g, replacement: "U-R-I" },
  { pattern: /\bURIs\b/g, replacement: "U-R-Is" },
  { pattern: /\bCLI\b/g, replacement: "C-L-I" },
  { pattern: /\bGUI\b/g, replacement: "gooey" },
  { pattern: /\bRESTful\b/g, replacement: "Rest-ful" },
  { pattern: /\bGraphQL\b/g, replacement: "Graph-Q-L" },
  { pattern: /\bPyTorch\b/g, replacement: "Pie-Torch" },
  { pattern: /\bkubectl\b/g, replacement: "kube-control" },
  { pattern: /\bOAuth\b/g, replacement: "O-Auth" },
  { pattern: /\bOAuth2\b/g, replacement: "O-Auth 2" },
  { pattern: /\bJWT\b/g, replacement: "J-W-T" },
  { pattern: /\bJWTs\b/g, replacement: "J-W-Ts" },
  { pattern: /\bCI\/CD\b/gi, replacement: "C-I C-D" },
  { pattern: /\bLLM\b/g, replacement: "L-L-M" },
  { pattern: /\bLLMs\b/g, replacement: "L-L-Ms" },
  { pattern: /\bRAG\b/g, replacement: "Rag" },
  { pattern: /\bSDK\b/g, replacement: "S-D-K" },
  { pattern: /\bSDKs\b/g, replacement: "S-D-Ks" },
  { pattern: /\bUUID\b/g, replacement: "U-U-I-D" },

  // 4. Common Latin & Shorthand abbreviations
  { pattern: /\bi\.e\.,?/gi, replacement: "that is," },
  { pattern: /\be\.g\.,?/gi, replacement: "for example," },
  { pattern: /\betc\.?/gi, replacement: "and so on" },
  { pattern: /\bvs\.?\b/gi, replacement: "versus" },

  // 5. Code Syntax and Angle Brackets in Narration (read naturally rather than saying 'less than'/'greater than')
  { pattern: /<\s*([A-Za-z0-9_]+)\s*>/g, replacement: (_match, p1) => `the ${p1} tag` },
  { pattern: /<\s*\/\s*([A-Za-z0-9_]+)\s*>/g, replacement: (_match, p1) => `closing ${p1} tag` },

  // 6. Natural pause formatting (ensure em-dashes and colons have speakable cadence)
  { pattern: /\s*—\s*/g, replacement: " — " },
  { pattern: /\s*:\s*(?=[A-Za-z0-9])/g, replacement: ": " },
];

/**
 * Prepares raw technical narration text for natural, accurate spoken delivery.
 * Cleans up awkward math symbols, expands technical abbreviations, and formats
 * pauses for human-sounding narration.
 */
export function prepareTextForSpeech(rawText: string): string {
  if (!rawText) return "";
  let text = rawText.trim();

  // Strip excessive literal JSON formatting in narration if it repeats braces awkwardly
  text = text.replace(/\{\s*"([^"]+)"\s*:\s*"([^"]+)"\s*\}/g, 'a key-value pair of "$1" with value "$2"');

  for (const rule of PRONUNCIATION_RULES) {
    // @ts-expect-error String.replace with RegExp supports function and string replacements
    text = text.replace(rule.pattern, rule.replacement);
  }

  // Clean up any double spaces or awkward punctuation produced by replacements
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/([,.;!?])\1+/g, "$1")
    .trim();

  return text;
}
