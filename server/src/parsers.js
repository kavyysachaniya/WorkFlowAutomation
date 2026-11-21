// Parser interface: anything with { id, label, ai, parse(text, opts) -> Promise<{ok, workflow} | {ok:false, errors}> }.
// Today there is one implementation (rule-based regex). An LLM-backed parser can be added here
// and selected with PARSER=<id>; its output still goes through validateWorkflow() before saving.
import { parseWorkflow } from './parser.js';

export const ruleBasedParser = {
  id: 'rules',
  label: 'Rule-based parser (no AI)',
  ai: false,
  async parse(text, opts) { return parseWorkflow(text, opts); },
};

const PARSERS = { [ruleBasedParser.id]: ruleBasedParser };

export function selectParser(id = process.env.PARSER || 'rules') {
  const p = PARSERS[id];
  if (!p) throw new Error(`Unknown PARSER "${id}". Available: ${Object.keys(PARSERS).join(', ')}`);
  return p;
}
