'use strict';

// Test end-to-end via HTTP contro il vero progetto Supabase di Meelu.
// Richiede SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY in .env (vedi .env.example);
// crea utenti/proposte/ticket reali e li ripulisce alla fine.

const assert = require('assert');
const server = require('./server');
const { restRequest } = require('./db');

const JESI_CENTRO = { lat: 43.5219, lng: 13.2381 };

function unique(label) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function main() {
  const port = await new Promise((resolve) => {
    server.listen(0, () => resolve(server.address().port));
  });
  const base = `http://localhost:${port}`;
  const createdUserIds = [];
  const createdProposalIds = [];

  async function call(method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  try {
    // 1. tre utenti, due dei quali condividono un interesse con la prima
    const alice = (
      await call('POST', '/api/users', {
        name: unique('Alice'),
        birthYear: 1994,
        interests: ['scacchi', 'trekking'],
      })
    ).body;
    createdUserIds.push(alice.id);

    const bob = (
      await call('POST', '/api/users', {
        name: unique('Bob'),
        birthYear: 1991,
        interests: ['scacchi', 'fotografia'],
      })
    ).body;
    createdUserIds.push(bob.id);

    const carol = (
      await call('POST', '/api/users', {
        name: unique('Carol'),
        birthYear: 1996,
        interests: ['scacchi'],
      })
    ).body;
    createdUserIds.push(carol.id);

    // 2. tutti e tre si rendono disponibili nello stesso punto a Jesi
    for (const user of [alice, bob, carol]) {
      const r = await call('POST', `/api/availability/${user.id}`, { ...JESI_CENTRO, radiusM: 300 });
      assert.strictEqual(r.status, 200, `attivazione disponibilità fallita per ${user.name}`);
    }

    // 3. Alice deve vedere Bob e Carol tra i candidati vicini con interessi comuni
    const matches = await call('GET', `/api/matches/${alice.id}`);
    assert.strictEqual(matches.status, 200);
    const candidateIds = matches.body.candidates.map((c) => c.userId);
    assert(candidateIds.includes(bob.id), 'Bob dovrebbe comparire tra i candidati di Alice');
    assert(candidateIds.includes(carol.id), 'Carol dovrebbe comparire tra i candidati di Alice');

    // 4. Alice propone un incontro a Bob, entrambi accettano -> match
    const proposal = (await call('POST', '/api/proposals', { userId: alice.id, candidateId: bob.id }))
      .body;
    createdProposalIds.push(proposal.proposalId);

    const aliceWaiting = await call('POST', `/api/proposals/${proposal.proposalId}/respond`, {
      userId: alice.id,
      response: 'accept',
    });
    assert.strictEqual(
      aliceWaiting.body.status,
      'waiting',
      'dopo un solo sì la proposta deve restare in attesa'
    );

    const bobMatched = await call('POST', `/api/proposals/${proposal.proposalId}/respond`, {
      userId: bob.id,
      response: 'accept',
    });
    assert.strictEqual(bobMatched.body.status, 'matched');
    assert.strictEqual(bobMatched.body.match.userId, alice.id);

    const aliceView = await call('GET', `/api/proposals/${proposal.proposalId}?userId=${alice.id}`);
    assert.strictEqual(aliceView.body.status, 'matched');
    assert.strictEqual(
      aliceView.body.match.userId,
      bob.id,
      'nome e foto del match devono comparire solo ora, dopo il doppio sì'
    );

    // 5. il biglietto d'incontro si genera solo dopo il doppio sì
    const ticket = await call('POST', '/api/tickets', {
      proposalId: proposal.proposalId,
      userId: alice.id,
      place: 'Caffè Centrale, Jesi',
      suggestedTime: 'oggi alle 18:30',
      icebreaker: 'Chi ha vinto la vostra ultima partita a scacchi?',
    });
    assert.strictEqual(ticket.status, 201);
    assert.match(ticket.body.code, /^\d{4}$/, 'il codice di sicurezza del biglietto deve essere a 4 cifre');

    // 6. Alice rifiuta la proposta con Carol: per Carol il rifiuto resta invisibile
    const proposalWithCarol = (
      await call('POST', '/api/proposals', { userId: alice.id, candidateId: carol.id })
    ).body;
    createdProposalIds.push(proposalWithCarol.proposalId);

    const aliceDeclines = await call('POST', `/api/proposals/${proposalWithCarol.proposalId}/respond`, {
      userId: alice.id,
      response: 'decline',
    });
    assert.strictEqual(aliceDeclines.body.status, 'declined_by_me');

    const carolView = await call(
      'GET',
      `/api/proposals/${proposalWithCarol.proposalId}?userId=${carol.id}`
    );
    assert.strictEqual(
      carolView.body.status,
      'expired',
      'Carol non deve mai vedere che Alice ha rifiutato'
    );

    console.log('Tutti i test sono passati.');
  } finally {
    // pulizia: rimuove solo i dati creati da questo test
    for (const proposalId of createdProposalIds) {
      await restRequest('DELETE', '/tickets', { query: { proposal_id: `eq.${proposalId}` } });
      await restRequest('DELETE', '/proposal_responses', { query: { proposal_id: `eq.${proposalId}` } });
      await restRequest('DELETE', '/proposals', { query: { id: `eq.${proposalId}` } });
    }
    for (const userId of createdUserIds) {
      await restRequest('DELETE', '/availability', { query: { user_id: `eq.${userId}` } });
      await restRequest('DELETE', '/users', { query: { id: `eq.${userId}` } });
    }
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
