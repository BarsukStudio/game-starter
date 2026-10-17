import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameEventChannel } from '../template/platform/game-event-channel.js';

// The declarations below mirror the shapes Gym, Gym2 and Miner shipped before the
// channel moved here: tokens, counters, a once-per-launch first action, and store
// product ids, which carry dots and differ per store.
const declaration = () => ({
  schemaRevision: 1,
  events: {
    game_ready: [],
    location_view: ['location'],
    first_action: ['location'],
    upgrade_purchased: ['item', 'item_index', 'amount'],
    purchase_start: ['product'],
  },
  oncePerLaunch: ['game_ready', 'first_action'],
  valuePatterns: { product: /^[a-z0-9_.-]{1,100}$/ },
});

function channel(overrides = {}) {
  const events = [];
  const created = createGameEventChannel({ ...declaration(), ...overrides });
  created.subscribeGameEvents((event) => events.push(event));
  return { ...created, events };
}

test('a declared event is published with the prefix, the revision and only declared fields', () => {
  const { emitGameEvent, events } = channel();
  assert.equal(emitGameEvent('upgrade_purchased', { item: 'gloves', item_index: 2, amount: 150, secret: 'x' }), true);
  assert.equal(emitGameEvent('game_ready'), true);
  assert.deepEqual(events, [
    { name: 'bs_upgrade_purchased', params: { schema_revision: 1, item: 'gloves', item_index: 2, amount: 150 } },
    { name: 'bs_game_ready', params: { schema_revision: 1 } },
  ]);
  assert.ok(Object.isFrozen(events[0]) && Object.isFrozen(events[0].params));
});

test('an undeclared or inherited name sends nothing', () => {
  const { emitGameEvent, events } = channel();
  for (const name of ['level_up', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(emitGameEvent(name, {}), false, name);
  }
  assert.deepEqual(events, []);
});

test('a field outside the rules drops the whole event', () => {
  const { emitGameEvent, events } = channel();
  const rejected = [
    { location: 'Gym' }, { location: 'a b' }, { location: '' }, { location: 'x'.repeat(41) },
    { location: -1 }, { location: NaN }, { location: Infinity }, { location: true }, { location: null }, {},
  ];
  for (const values of rejected) assert.equal(emitGameEvent('location_view', values), false, JSON.stringify(values));
  assert.equal(emitGameEvent('location_view', null), false);
  assert.equal(emitGameEvent('location_view'), false);
  assert.deepEqual(events, []);
});

test('a declared pattern widens one field, and no string passes 100 characters', () => {
  const { emitGameEvent, events } = channel({ valuePatterns: { product: /^[a-z0-9_.-]+$/ } });
  assert.equal(emitGameEvent('purchase_start', { product: 'com.example.game.coins_1000' }), true);
  assert.equal(emitGameEvent('purchase_start', { product: 'a'.repeat(101) }), false);
  assert.equal(emitGameEvent('location_view', { location: 'com.example' }), false);
  assert.deepEqual(events.map((event) => event.params.product), ['com.example.game.coins_1000']);
});

test('a once-per-launch event counts only once it is actually sent', () => {
  const { emitGameEvent, events } = channel();
  assert.equal(emitGameEvent('first_action', { location: 'Bad' }), false);
  assert.equal(emitGameEvent('first_action', { location: 'mine_1' }), true);
  assert.equal(emitGameEvent('first_action', { location: 'mine_2' }), false);
  assert.equal(emitGameEvent('location_view', { location: 'mine_2' }), true);
  assert.equal(emitGameEvent('location_view', { location: 'mine_2' }), true);
  assert.deepEqual(events.map((event) => event.name), ['bs_first_action', 'bs_location_view', 'bs_location_view']);
  // Each channel is its own launch record.
  assert.equal(channel().emitGameEvent('first_action', { location: 'mine_1' }), true);
});

test('a throwing listener neither interrupts the game nor starves another listener', () => {
  const { emitGameEvent, subscribeGameEvents, events } = channel();
  const stop = subscribeGameEvents(() => { throw Error('offline'); });
  assert.equal(emitGameEvent('location_view', { location: 'shop' }), true);
  stop();
  const late = [];
  const stopLate = subscribeGameEvents((event) => late.push(event.name));
  stopLate();
  assert.equal(emitGameEvent('location_view', { location: 'shop' }), true);
  assert.equal(events.length, 2);
  assert.deepEqual(late, []);
});

test('the channel does not need Object.hasOwn', () => {
  const hasOwn = Object.hasOwn;
  delete Object.hasOwn;
  try {
    const { emitGameEvent, events } = channel();
    assert.equal(emitGameEvent('game_ready'), true);
    assert.equal(events.length, 1);
  } finally {
    Object.hasOwn = hasOwn;
  }
});

test('a declaration Analytics would drop or truncate fails at creation', () => {
  const invalid = [
    { schemaRevision: 0 },
    { schemaRevision: '1' },
    { events: { 'Level-Up': [] } },
    { events: { [`e${'x'.repeat(37)}`]: [] } },
    { events: { level_up: ['Level'] } },
    { events: { level_up: [`p${'x'.repeat(40)}`] } },
    { events: { level_up: ['level', 'level'] } },
    { events: { level_up: ['schema_revision'] } },
    { events: { level_up: ['firebase_level'] } },
    { events: { level_up: ['google_level'] } },
    { events: { level_up: ['ga_level'] } },
    { events: { level_up: Array.from({ length: 25 }, (_, index) => `p${index}`) } },
    { events: { level_up: 'level' } },
    { oncePerLaunch: ['level_up'] },
    { oncePerLaunch: ['game_ready', 'level_up'] },
    { valuePatterns: { product: '^[a-z.]+$' } },
    { valuePatterns: { product: /^[a-z.]+$/g } },
    { valuePatterns: { product: /^[a-z.]+$/y } },
  ];
  for (const overrides of invalid) {
    // oncePerLaunch is emptied so each case throws for its own reason only.
    assert.throws(() => createGameEventChannel({ ...declaration(), oncePerLaunch: [], ...overrides }), TypeError, JSON.stringify(overrides));
  }
  // The longest accepted shapes: a 40-character event name and 24 fields beside the revision.
  const name = `e${'x'.repeat(36)}`;
  const fields = Array.from({ length: 24 }, (_, index) => `p${index}`);
  const { emitGameEvent, events } = channel({ events: { [name]: fields }, oncePerLaunch: [] });
  assert.equal(emitGameEvent(name, Object.fromEntries(fields.map((field) => [field, 1]))), true);
  assert.equal(events[0].name.length, 40);
  assert.equal(Object.keys(events[0].params).length, 25);
});
