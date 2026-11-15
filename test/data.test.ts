import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Person, SeasonRecord, Settings, Snapshot, Ticket } from '../src/domain/types.js';
import { seasonStart } from '../src/lib/season-rules.js';
import {
  api,
  createAdmin,
  createTestContext,
  login,
  resetData,
  resetUsers,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let call: ReturnType<typeof api>;

beforeAll(async () => {
  ctx = await createTestContext();
  await resetUsers(ctx.db);
  await createAdmin(ctx);
  call = api(ctx, await login(ctx));
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetData(ctx.db);
});

async function addPerson(firstName = 'arben', fatherName = 'ilir', lastName = 'hoxha') {
  const res = await call('POST', '/v1/people', { firstName, fatherName, lastName });
  expect(res.statusCode).toBe(201);
  return res.json<{ person: Person; createdTickets: Ticket[] }>();
}

async function startSeason() {
  const res = await call('POST', '/v1/seasons/start');
  expect(res.statusCode).toBe(201);
  return res.json<{ season: SeasonRecord; createdTickets: number }>();
}

async function tickets(query = '') {
  return (await call('GET', `/v1/tickets${query}`)).json<Ticket[]>();
}

describe('people', () => {
  it('creates, reads, updates and deletes a person', async () => {
    const { person, createdTickets } = await addPerson();
    expect(person).toEqual({
      id: expect.any(String),
      firstName: 'Arben',
      fatherName: 'Ilir',
      lastName: 'Hoxha',
      createdAt: expect.any(String),
    });
    expect(createdTickets).toEqual([]); // no season started yet

    expect((await call('GET', `/v1/people/${person.id}`)).json()).toEqual(person);

    const updated = await call('PUT', `/v1/people/${person.id}`, {
      firstName: 'Arben',
      fatherName: 'Ilir',
      lastName: 'krasniqi',
    });
    expect(updated.json<Person>().lastName).toBe('Krasniqi');

    expect((await call('DELETE', `/v1/people/${person.id}`)).statusCode).toBe(204);
    expect((await call('GET', `/v1/people/${person.id}`)).statusCode).toBe(404);
    expect((await call('GET', '/v1/people')).json()).toEqual([]);
  });

  it('validates names', async () => {
    const res = await call('POST', '/v1/people', { firstName: '  ', fatherName: 'a', lastName: 'b' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details).toEqual([expect.objectContaining({ path: 'firstName' })]);
  });

  it('deleting a person deletes their tickets too', async () => {
    const { person } = await addPerson();
    await startSeason();
    expect(await tickets()).toHaveLength(1);
    await call('DELETE', `/v1/people/${person.id}`);
    expect(await tickets()).toEqual([]);
  });
});

describe('seasons and yearly tickets', () => {
  it('starting a season creates an unpaid yearly ticket for everyone', async () => {
    await addPerson('a', 'b', 'c');
    await addPerson('d', 'e', 'f');
    const { season, createdTickets } = await startSeason();

    expect(season).toEqual(expect.objectContaining({ year: 2027, month: 9 }));
    expect(createdTickets).toBe(2);
    const list = await tickets();
    expect(list.map((t) => [t.number, t.kind, t.status, t.amount, t.due, t.season])).toEqual([
      [1, 'annual', 'unpaid', 35, 35, 2027],
      [2, 'annual', 'unpaid', 35, 35, 2027],
    ]);
    expect(list[0]!.reasons).toEqual(['Mirëmbajtja e oborrit']);
    expect(list[0]!.paidAt).toBeUndefined();

    const next = await startSeason();
    expect(next.season.year).toBe(2028);
    expect(await tickets('?season=2028')).toHaveLength(2);
  });

  it('a person added during a season gets that season’s yearly ticket', async () => {
    await startSeason();
    const { createdTickets } = await addPerson();
    expect(createdTickets).toHaveLength(1);
    expect(createdTickets[0]).toEqual(
      expect.objectContaining({ kind: 'annual', season: 2027, status: 'unpaid' }),
    );
  });

  it('a deleted yearly ticket is not generated again', async () => {
    const { person } = await addPerson();
    await startSeason();
    const [annual] = await tickets();
    expect((await call('DELETE', `/v1/tickets/${annual!.id}`)).statusCode).toBe(204);

    await startSeason(); // runs the yearly-ticket check again
    const list = await tickets(`?personId=${person.id}`);
    expect(list.map((t) => t.season)).toEqual([2028]);

    const snapshot = (await call('GET', '/v1/sync')).json<Snapshot>();
    expect(snapshot.dismissedAnnual).toEqual([`${person.id}:2027`]);
  });

  it('starts due seasons automatically (catching up at most 5)', async () => {
    await addPerson();
    const started = await ctx.services.seasons.startDue(seasonStart(2029, 9), { userId: null, ip: null });
    expect(started.map((s) => s.year)).toEqual([2027, 2028, 2029]);
    expect(started[0]!.startedAt).toBe(seasonStart(2027, 9).toISOString());
    expect(await tickets()).toHaveLength(3);

    // Nothing more is due yet.
    expect(await ctx.services.seasons.startDue(seasonStart(2029, 9), { userId: null, ip: null })).toEqual([]);
  });
});

describe('payments', () => {
  it('settles an unpaid yearly ticket', async () => {
    const { person } = await addPerson();
    await startSeason();
    const [annual] = await tickets();

    const res = await call('POST', '/v1/payments', {
      personId: person.id,
      amount: 35,
      reasons: ['Mirëmbajtja e oborrit'],
      note: '  paguar në dorë  ',
      settleTicketId: annual!.id,
    });
    expect(res.statusCode).toBe(201);
    const paid = res.json<Ticket>();
    expect(paid).toEqual(
      expect.objectContaining({
        id: annual!.id,
        number: 1,
        status: 'paid',
        amount: 35,
        note: 'paguar në dorë',
      }),
    );
    expect(paid.paidAt).toBeTruthy();

    const again = await call('POST', '/v1/payments', {
      personId: person.id,
      amount: 35,
      reasons: [],
      settleTicketId: annual!.id,
    });
    expect(again.statusCode).toBe(409);
  });

  it('records extra payments with the next receipt number', async () => {
    const { person } = await addPerson();
    const first = await call('POST', '/v1/payments', {
      personId: person.id,
      amount: 12.5,
      reasons: ['Pastrimi'],
    });
    const second = await call('POST', '/v1/payments', { personId: person.id, amount: 20, reasons: [] });
    expect(first.json<Ticket>()).toEqual(
      expect.objectContaining({ number: 1, kind: 'payment', season: 2027, amount: 12.5, status: 'paid' }),
    );
    expect(first.json<Ticket>().due).toBeUndefined();
    expect(second.json<Ticket>().number).toBe(2);
  });

  it('allows only one yearly ticket per person and season', async () => {
    const { person } = await addPerson();
    const annual = await call('POST', '/v1/payments', {
      personId: person.id,
      amount: 35,
      reasons: [],
      asAnnual: true,
    });
    expect(annual.json<Ticket>()).toEqual(
      expect.objectContaining({ kind: 'annual', due: 35, status: 'paid' }),
    );

    const duplicate = await call('POST', '/v1/payments', {
      personId: person.id,
      amount: 35,
      reasons: [],
      asAnnual: true,
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('ANNUAL_TICKET_EXISTS');
  });

  it('validates payment input', async () => {
    const { person } = await addPerson();
    const bad = [
      { personId: person.id, amount: 0, reasons: [] },
      { personId: person.id, amount: -5, reasons: [] },
      { personId: person.id, amount: 10.555, reasons: [] },
      { personId: person.id, amount: '10', reasons: [] },
      { personId: person.id, amount: 10, reasons: [], settleTicketId: 'x', asAnnual: true },
    ];
    for (const body of bad) expect((await call('POST', '/v1/payments', body)).statusCode).toBe(400);

    const unknown = await call('POST', '/v1/payments', { personId: 'nobody', amount: 10, reasons: [] });
    expect(unknown.statusCode).toBe(404);
  });

  it('hands out unique, gap-free receipt numbers under concurrent requests', async () => {
    const { person } = await addPerson();
    const results = await Promise.all(
      Array.from({ length: 15 }, () =>
        call('POST', '/v1/payments', { personId: person.id, amount: 1, reasons: [] }),
      ),
    );
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    const numbers = results.map((r) => r.json<Ticket>().number).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });

  it('marks tickets paid and unpaid', async () => {
    await addPerson();
    await startSeason();
    const [annual] = await tickets();

    const paid = await call('POST', `/v1/tickets/${annual!.id}/pay`, { amount: 30 });
    expect(paid.json<Ticket>()).toEqual(expect.objectContaining({ status: 'paid', amount: 30 }));

    const unpaid = await call('POST', `/v1/tickets/${annual!.id}/unpay`);
    expect(unpaid.json<Ticket>()).toEqual(expect.objectContaining({ status: 'unpaid', amount: 35 }));
    expect(unpaid.json<Ticket>().paidAt).toBeUndefined();

    const payNoBody = await call('POST', `/v1/tickets/${annual!.id}/pay`);
    expect(payNoBody.json<Ticket>()).toEqual(expect.objectContaining({ status: 'paid', amount: 35 }));
  });

  it('filters tickets', async () => {
    const { person } = await addPerson();
    await startSeason();
    await call('POST', '/v1/payments', { personId: person.id, amount: 5, reasons: [] });
    expect(await tickets('?status=unpaid')).toHaveLength(1);
    expect(await tickets('?kind=payment')).toHaveLength(1);
    expect((await call('GET', '/v1/tickets?status=lost')).statusCode).toBe(400);
  });
});

describe('settings', () => {
  it('returns the app defaults and updates only the sent fields', async () => {
    const defaults = (await call('GET', '/v1/settings')).json<Settings>();
    expect(defaults).toEqual({
      adminName: 'Administratori',
      organization: 'Mirëmbajtja e Oborrit',
      goal: 2500,
      annualFee: 35,
      seasonStartMonth: 9,
      seasonStartYear: 2027,
      reasons: ['Mirëmbajtja e oborrit', 'Kositja e barit', 'Pastrimi'],
      paperWidth: 58,
    });

    const res = await call('PATCH', '/v1/settings', {
      annualFee: 40,
      reasons: ['Pastrimi', ' pastrimi ', 'Ndriçimi'],
      paperWidth: 80,
    });
    expect(res.json<Settings>()).toEqual({
      ...defaults,
      annualFee: 40,
      reasons: ['Pastrimi', 'Ndriçimi'],
      paperWidth: 80,
    });

    for (const body of [{ paperWidth: 60 }, { seasonStartMonth: 12 }, { annualFee: -1 }, { foo: 1 }]) {
      expect((await call('PATCH', '/v1/settings', body)).statusCode).toBe(400);
    }
  });

  it('new yearly tickets use the current fee', async () => {
    await addPerson();
    await call('PATCH', '/v1/settings', { annualFee: 50 });
    await startSeason();
    expect((await tickets())[0]).toEqual(expect.objectContaining({ amount: 50, due: 50 }));
  });
});

describe('sync and import', () => {
  const phoneData: Snapshot = {
    people: [
      {
        id: 'mbx3k2a1b2c3',
        firstName: 'Arben',
        fatherName: 'Ilir',
        lastName: 'Hoxha',
        createdAt: '2027-05-01T10:00:00.000Z',
      },
      {
        id: 'mbx3k9zz9z9z',
        firstName: 'Drita',
        fatherName: 'Agim',
        lastName: 'Berisha',
        createdAt: '2027-06-01T10:00:00.000Z',
      },
    ],
    tickets: [
      {
        id: 't1',
        number: 1,
        personId: 'mbx3k2a1b2c3',
        kind: 'annual',
        season: 2027,
        amount: 35,
        due: 35,
        reasons: ['Mirëmbajtja e oborrit'],
        status: 'paid',
        createdAt: '2027-09-30T22:00:00.000Z',
        paidAt: '2027-10-05T09:00:00.000Z',
      },
      {
        id: 't3',
        number: 3,
        personId: 'mbx3k2a1b2c3',
        kind: 'payment',
        season: 2027,
        amount: 15.5,
        reasons: ['Pastrimi'],
        status: 'paid',
        note: 'Dhuratë',
        createdAt: '2027-11-01T09:00:00.000Z',
        paidAt: '2027-11-01T09:00:00.000Z',
      },
    ],
    settings: {
      adminName: 'Babi',
      organization: 'Sallagrazhda',
      goal: 3000,
      annualFee: 35,
      seasonStartMonth: 9,
      seasonStartYear: 2027,
      reasons: ['Mirëmbajtja e oborrit', 'Pastrimi'],
      paperWidth: 58,
    },
    seasons: [{ year: 2027, month: 9, startedAt: '2027-09-30T22:00:00.000Z' }],
    nextTicketNumber: 4,
    dismissedAnnual: ['mbx3k9zz9z9z:2027'],
  };

  it('imports the phone data once and returns it unchanged in /v1/sync', async () => {
    const res = await call('POST', '/v1/import', phoneData);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ people: 2, tickets: 2, seasons: 1, dismissedAnnual: 1 });

    const snapshot = (await call('GET', '/v1/sync')).json<Snapshot & { serverTime: string }>();
    const { serverTime, ...data } = snapshot;
    expect(serverTime).toBeTruthy();
    expect(data).toEqual(phoneData);

    // The receipt counter continues after the imported numbers.
    const next = await call('POST', '/v1/payments', { personId: 'mbx3k2a1b2c3', amount: 1, reasons: [] });
    expect(next.json<Ticket>().number).toBe(4);

    // Never overwrites live data.
    const again = await call('POST', '/v1/import', phoneData);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('SERVER_NOT_EMPTY');
  });

  it('rejects inconsistent data without importing anything', async () => {
    const broken: Snapshot = {
      ...phoneData,
      tickets: [...phoneData.tickets, { ...phoneData.tickets[1]!, id: 't4', personId: 'ghost' }],
    };
    const res = await call('POST', '/v1/import', broken);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json().error.details)).toContain('Duplicate ticket number: 3');
    expect((await call('GET', '/v1/people')).json()).toEqual([]);
  });

  it('writes an audit trail for changes', async () => {
    const { person } = await addPerson();
    await call('POST', '/v1/payments', { personId: person.id, amount: 5, reasons: [] });
    await call('DELETE', `/v1/people/${person.id}`);
    const { rows } = await ctx.db.query<{ action: string; user_id: string | null }>(
      'SELECT action, user_id FROM audit_log ORDER BY id',
    );
    expect(rows.map((r) => r.action)).toEqual(['person.create', 'payment.create', 'person.delete']);
    expect(rows.every((r) => r.user_id)).toBe(true);
  });
});
