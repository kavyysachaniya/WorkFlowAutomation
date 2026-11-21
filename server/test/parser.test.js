// Unit tests for the rule-based (no AI) plain-English parser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkflow } from '../src/parser.js';
import { validateWorkflow } from '../src/engine.js';

// Every successful parse must produce a workflow the engine accepts.
function parseOk(text) {
  const r = parseWorkflow(text);
  assert.equal(r.ok, true, `expected parse to succeed: ${JSON.stringify(r.errors)}`);
  assert.deepEqual(validateWorkflow(r.workflow).errors, [], 'parser output passes engine validation');
  return r.workflow;
}
function parseErr(text) {
  const r = parseWorkflow(text);
  assert.equal(r.ok, false, 'expected parse to fail');
  assert.ok(r.errors.length > 0);
  return r.errors;
}

test('the problem statement example', () => {
  const wf = parseOk('When a new order arrives, if it is over $500, wait one day, then send a follow-up message.');
  assert.deepEqual(wf.trigger, { event: 'order.placed' });
  assert.deepEqual(wf.steps, [
    { type: 'branch', condition: { field: 'total', op: 'gt', value: 500 }, skip: 2 }, // guards the rest of the sentence
    { type: 'wait', amount: 1, unit: 'day' },
    { type: 'message', channel: 'email', body: 'Follow-up message' },
  ]);
});

test('multi-sentence workflow: if guards only its own sentence; quoted bodies are kept verbatim', () => {
  const wf = parseOk('When a user signs up, create their account, then send a "Welcome aboard, {{name}}. Glad you joined!" email. Wait 2 days. If plan is pro, send a Slack message "New pro signup". After 1 week send a "How is it going?" email.');
  assert.equal(wf.trigger.event, 'user.signed_up');
  assert.deepEqual(wf.steps.map((s) => s.type), ['task', 'message', 'wait', 'branch', 'message', 'wait', 'message']);
  assert.equal(wf.steps[1].body, 'Welcome aboard, {{name}}. Glad you joined!');
  assert.deepEqual(wf.steps[3], { type: 'branch', condition: { field: 'plan', op: 'eq', value: 'pro' }, skip: 1 });
  assert.equal(wf.steps[4].channel, 'slack');
  assert.deepEqual(wf.steps[5], { type: 'wait', amount: 1, unit: 'week' });
});

test('"If X." on its own guards the next step', () => {
  const wf = parseOk('When a user signs up. If plan is pro. Send a slack message. Send an email.');
  assert.equal(wf.steps[0].skip, 1);
  assert.deepEqual(wf.steps.map((s) => s.type), ['branch', 'message', 'message']);
});

test('trigger conditions ("only if") vs branch steps', () => {
  const wf = parseOk('When an order is placed, only if total is greater than 50 and country is IN. Tag the customer as VIP and send a "Thanks" email.');
  assert.deepEqual(wf.conditions, [
    { field: 'total', op: 'gt', value: 50 },
    { field: 'country', op: 'eq', value: 'IN' },
  ]);
  assert.deepEqual(wf.steps.map((s) => s.type), ['task', 'message']);
});

test('condition operators and value coercion', () => {
  const op = (cond) => parseOk(`When a user signs up, if ${cond}, send email`).steps[0].condition;
  assert.deepEqual(op('plan is not free'), { field: 'plan', op: 'neq', value: 'free' });
  assert.deepEqual(op('total is less than 20'), { field: 'total', op: 'lt', value: 20 });
  assert.deepEqual(op('it is over $1,200'), { field: 'total', op: 'gt', value: 1200 });
  assert.deepEqual(op('email contains gmail'), { field: 'email', op: 'contains', value: 'gmail' });
  assert.deepEqual(op('verified is true'), { field: 'verified', op: 'eq', value: true });
  assert.deepEqual(op('they have a coupon'), { field: 'coupon', op: 'exists' });
});

test('wait amounts and units', () => {
  const wait = (w) => parseOk(`When a user signs up, ${w}, send email`).steps[0];
  assert.deepEqual(wait('wait 3 hours'), { type: 'wait', amount: 3, unit: 'hour' });
  assert.deepEqual(wait('after a week'), { type: 'wait', amount: 1, unit: 'week' });
  assert.deepEqual(wait('wait for two days'), { type: 'wait', amount: 2, unit: 'day' });
  assert.deepEqual(wait('delay 30 mins'), { type: 'wait', amount: 30, unit: 'minute' });
  assert.deepEqual(wait('pause 1.5 days'), { type: 'wait', amount: 1.5, unit: 'day' });
});

test('message channels', () => {
  const ch = (s) => parseOk(`When a user signs up, ${s}`).steps[0].channel;
  assert.equal(ch('send a welcome email'), 'email');
  assert.equal(ch('text them a code'), 'sms');
  assert.equal(ch('send a slack message to the sales team'), 'slack');
});

test('known and explicit trigger events', () => {
  const ev = (t) => parseOk(`When ${t}, send email`).trigger.event;
  assert.equal(ev('a cart is abandoned'), 'cart.abandoned');
  assert.equal(ev('a customer cancels'), 'subscription.cancelled');
  assert.equal(ev('someone starts a trial'), 'trial.started');
  assert.equal(ev('order.refunded happens'), 'order.refunded');
});

test('errors are reported, never guessed', () => {
  assert.match(parseErr('')[0].reason, /empty/i);
  assert.match(parseErr('Send an email every day')[0].reason, /Start with a trigger/);
  assert.match(parseErr('When the moon rises, send email')[0].reason, /Unknown trigger/);
  const errs = parseErr('When a user signs up, dance wildly, then send email');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].clause, 'dance wildly');
  assert.match(parseErr('When a user signs up, send email. If plan is pro.')[0].reason, /no step after it/);
  assert.match(parseErr('When a user signs up, if the moon, send email')[0].reason, /condition/i);
});
