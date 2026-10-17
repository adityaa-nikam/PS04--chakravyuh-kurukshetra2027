import { loadCliEnvironment } from "./cli-environment";
import { parseExplainArgs } from "./explain-options";
import { explain } from "./explain-pipeline";

async function main() {
  if (process.argv.includes("--help")) {
    console.log('Usage: npm run explain -- "Your explanation prompt" [--audience Beginners] [--duration 45] [--output path/final.mp4] [--approve-overrun]\nResume: npm run explain -- --resume artifacts/requests/request-ID/request.json [--approve-overrun]\nAlso: --visual-actions (opt-in compact action planner; switching a saved graph request requires --replan), --inspect (validate/save resolved plan without rendering), --replan (resume with new model visuals; preserves the original receipt), --width --height --fps --browser --visuals. Loads .env.local using Next environment precedence.');
    return;
  }
  loadCliEnvironment();
  const options = parseExplainArgs(process.argv.slice(2));
  const result = await explain(options);
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : "Explanation failed");
  process.exitCode = 1;
});
