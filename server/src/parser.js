// Rule-based (regex) parser: plain English -> workflow JSON. This is NOT AI.
// Anything it does not recognise is reported as an error rather than guessed.

const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fourteen: 14, thirty: 30 };
const UNIT = { sec: 'second', secs: 'second', second: 'second', seconds: 'second', min: 'minute', mins: 'minute', minute: 'minute', minutes: 'minute', hr: 'hour', hrs: 'hour', hour: 'hour', hours: 'hour', day: 'day', days: 'day', week: 'week', weeks: 'week', month: 'month', months: 'month' };

const TRIGGERS = [
  [/sign(?:s|ed)?[\s-]?up|registers?|registered|\bjoins?\b/, 'user.signed_up'],
  [/abandon\w*\s+(?:their\s+|a\s+|the\s+)?cart|cart\s+(?:is\s+)?abandon/, 'cart.abandoned'],
  [/cancel/, 'subscription.cancelled'],
  [/purchas|\bbuys?\b|\bbought\b|places?\s+an?\s+order|order\s+(?:is\s+)?(?:placed|received|created)|\bnew\s+order\b|order\s+(?:arrives|comes\s+in)|checks?\s+out/, 'order.placed'],
  [/upgrad/, 'plan.upgraded'],
  [/trial\s+(?:starts?|begins?|started)|starts?\s+a\s+trial/, 'trial.started'],
  [/submits?\b.*form|form\s+(?:is\s+)?submitted/, 'form.submitted'],
];

const STEP_VERB = '(?:wait|send|email|text|sms|notify|message|remind|create|add|tag|assign|mark|update|if|after|only|delay|pause|provision|generate|log|sync|archive|score)';
const SPLIT = new RegExp(
  String.raw`(?:\.(?=\s|$)|;|\n|!|,?\s+and\s+then\s+|,?\s+then\s+|,\s*(?=${STEP_VERB}\b)|\s+and\s+(?=(?:wait|send|email|text|notify|create|add|tag|assign|mark|delay|pause)\b))`,
  'i',
);

const WAIT_RE = /^(?:wait(?:\s+for)?|after|delay(?:\s+for)?|pause(?:\s+for)?)\s+(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fourteen|thirty)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\b\s*,?\s*(.*)$/i;
const MSG_RE = /^(?:send|email|text|sms|notify|message|dm|ping|remind)\b\s*(.*)$/i;
const TASK_RE = /^(?:create|add|tag|assign|mark|update|set|provision|generate|run|log|sync|enrich|archive|close|record|score|flag|move)\b/i;

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function coerce(v) {
  const t = v.trim();
  if (/^(true|yes)$/i.test(t)) return true;
  if (/^(false|no)$/i.test(t)) return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}
const fieldName = (s) => s.trim().toLowerCase()
  .replace(/^(?:the\s+)?(?:user'?s|customer'?s|their|its)\s+/, '').replace(/^the\s+/, '')
  .replace(/[^a-z0-9.]+/g, '_').replace(/^_|_$/g, '');

// "it", "the order", "order value"... compared against a number means the order total.
const TOTAL_ALIASES = new Set(['it', 'order', 'order_total', 'order_value', 'value', 'amount', 'price', 'its_total', 'cart', 'cart_value', 'cart_total']);
const NUMBER = String.raw`(-?\$?[\d,]+(?:\.\d+)?)`;

export function parseCondition(s, restore = (x) => x) {
  const t = s.trim();
  const rules = [
    [/^(.+?)\s+(?:is not|isn't|is n't|!=|does not equal|doesn't equal)\s+(.+)$/i, 'neq'],
    [new RegExp(String.raw`^(.+?)\s+(?:is greater than|is more than|is over|is above|is at least|exceeds|>=?)\s+${NUMBER}$`, 'i'), 'gt'],
    [new RegExp(String.raw`^(.+?)\s+(?:is less than|is under|is below|<)\s+${NUMBER}$`, 'i'), 'lt'],
    [/^(.+?)\s+(?:contains|includes)\s+(.+)$/i, 'contains'],
    [/^(.+?)\s+(?:is|equals|==|=|are)\s+(.+)$/i, 'eq'],
  ];
  for (const [re, op] of rules) {
    const m = t.match(re);
    if (m) {
      let field = fieldName(m[1]);
      if (!field) return null;
      let raw = restore(m[2]).replace(/^(?:a|an|the)\s+/i, '');
      if (op === 'gt' || op === 'lt') raw = raw.replace(/[$,]/g, '');
      const value = coerce(raw);
      if (typeof value === 'number' && TOTAL_ALIASES.has(field)) field = 'total';
      return { field, op, value };
    }
  }
  const has = t.match(/^(?:they\s+|user\s+|the user\s+)?(?:has|have)\s+(?:an?\s+)?(.+)$/i);
  if (has) return { field: fieldName(has[1]), op: 'exists' };
  return null;
}

export function parseWorkflow(text, { name } = {}) {
  const errors = [];
  if (!text || typeof text !== 'string' || !text.trim()) return { ok: false, errors: [{ clause: '', reason: 'Text is empty' }] };

  // Protect quoted strings from clause splitting.
  const quotes = [];
  const masked = text.replace(/"([^"]*)"|“([^”]*)”/g, (_, a, b) => `§${quotes.push(a ?? b) - 1}§`);
  const restore = (s) => s.replace(/§(\d+)§/g, (_, i) => quotes[Number(i)]);

  // Sentences first, then clauses, so an "if" can guard the rest of its sentence.
  const clean = (c) => (c ?? '').trim().replace(/^(?:and|also|,)\s+/i, '').replace(/[,\s]+$/, '');
  const sentences = masked.split(/\.(?=\s|$)|;|\n|!/).map((s) => s.split(SPLIT).map(clean).filter(Boolean)).filter((s) => s.length);

  let trigger = null;
  const conditions = [];
  const steps = [];
  // Branch scoping: "if X, A, then B." guards A and B (rest of the sentence).
  // "If X." on its own guards only the next step.
  let openBranches = [];   // branches opened in the current sentence: { b, start }
  let carried = [];        // branches whose sentence ended with nothing after them

  const pushStep = (s) => {
    steps.push(s);
    for (const b of carried) if (b !== s) b.skip = 1;
    carried = carried.filter((b) => b === s);
  };
  const endSentence = () => {
    for (const { b, start } of openBranches) {
      const n = steps.length - start;
      if (n > 0) b.skip = n; else carried.push(b);
    }
    openBranches = [];
  };

  function parseStepClause(c) {
    let m;
    if ((m = c.match(WAIT_RE))) {
      const raw = m[1].toLowerCase();
      const amount = NUM[raw] ?? Number(raw);
      pushStep({ type: 'wait', amount, unit: UNIT[m[2].toLowerCase()] });
      if (m[3]) parseStepClause(m[3]);
      return;
    }
    if ((m = c.match(/^(?:if|when)\s+(.+)$/i))) {
      const cond = parseCondition(m[1], restore);
      if (!cond) { errors.push({ clause: restore(c), reason: 'Could not read the condition. Try "if plan is pro" or "if total is greater than 100".' }); return; }
      const b = { type: 'branch', condition: cond, skip: null };
      pushStep(b);
      openBranches.push({ b, start: steps.length });
      return;
    }
    if ((m = c.match(MSG_RE))) {
      const channel = /\b(?:sms|text)\b/i.test(c) ? 'sms' : /\bslack\b/i.test(c) ? 'slack' : 'email';
      const q = c.match(/§(\d+)§/);
      let body = q ? quotes[Number(q[1])] : restore(m[1])
        .replace(/\s+to\s+(?:the\s+)?(?:[\w-]+\s+){0,2}?(?:user|customer|them|him|her|team|channel)\b.*$/i, '')
        .replace(/^(?:them\s+|the\s+user\s+|the\s+customer\s+)?(?:an?|the)\s+/i, '')
        .replace(/^(?:them|the user|the customer)\s+(?:about\s+)?/i, '')
        .replace(/^(?:an?|the)\s+/i, '')
        .trim();
      if (!body) body = channel === 'slack' ? 'Slack notification' : 'Notification';
      pushStep({ type: 'message', channel, body: cap(body) });
      return;
    }
    if (TASK_RE.test(c)) { pushStep({ type: 'task', name: cap(restore(c)) }); return; }
    errors.push({ clause: restore(c), reason: 'Not recognised. Steps must start with wait/after, send/email/text/notify, if, or a task verb (create, tag, assign, update...).' });
  }

  let i = 0;
  for (const sentence of sentences) {
    for (const c of sentence) handleClause(c, i++);
    endSentence();
  }

  function handleClause(c, i) {
    let m;
    if (i === 0) {
      const tm = c.match(/^(?:when(?:ever)?|on|once|as soon as)\s+(.+)$/i);
      if (!tm) { errors.push({ clause: restore(c), reason: 'Start with a trigger, e.g. "When a user signs up".' }); return; }
      const [body, ...rest] = tm[1].split(',');
      const tail = rest.join(',').trim();
      const explicit = restore(body).match(/\b([a-z_]+(?:\.[a-z_]+)+)\b/i);
      const known = TRIGGERS.find(([re]) => re.test(body));
      if (explicit) trigger = { event: explicit[1].toLowerCase() };
      else if (known) trigger = { event: known[1] };
      else errors.push({ clause: restore(c), reason: 'Unknown trigger. Known: signs up, places an order, abandons cart, cancels, upgrades, starts a trial, submits a form. Or name an event like "order.refunded".' });
      if (tail) parseStepClause(tail);
      return;
    }
    if ((m = c.match(/^only\s+(?:if|when|for)\s+(.+)$/i))) {
      for (const part of m[1].split(/\s+and\s+/i)) {
        const cond = parseCondition(part, restore);
        if (cond) conditions.push(cond);
        else errors.push({ clause: restore(part), reason: 'Could not read this trigger condition.' });
      }
      return;
    }
    parseStepClause(c);
  }

  for (const b of carried) errors.push({ clause: 'if ' + b.condition.field, reason: 'Condition has no step after it to guard.' });
  if (!trigger && !errors.length) errors.push({ clause: '', reason: 'No trigger found.' });
  if (trigger && steps.length === 0 && !errors.length) errors.push({ clause: '', reason: 'No steps found. Add e.g. "send a welcome email".' });
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    workflow: { name: name?.trim() || `On ${trigger.event}: ${steps.length} step${steps.length > 1 ? 's' : ''}`, trigger, conditions, steps },
  };
}
