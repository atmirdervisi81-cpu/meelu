'use strict';

const http = require('http');
const crypto = require('crypto');
const repository = require('./repository');

const PORT = process.env.PORT || 3000;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(Object.assign(new Error('Payload troppo grande'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('JSON non valido'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function generateMeetingCode() {
  return crypto.randomInt(1000, 10000).toString();
}

const routes = [
  {
    method: 'POST',
    pattern: /^\/api\/users$/,
    handler: async (req, res) => {
      const body = await readJsonBody(req);
      const user = await repository.createUser(body);
      sendJson(res, 201, user);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/users\/([^/]+)$/,
    handler: async (req, res, [userId]) => {
      const user = await repository.getUser(userId);
      if (!user) return sendJson(res, 404, { error: 'utente non trovato' });
      sendJson(res, 200, user);
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/users\/([^/]+)$/,
    handler: async (req, res, [userId]) => {
      const body = await readJsonBody(req);
      const user = await repository.updateUser(userId, body);
      sendJson(res, 200, user);
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/availability\/([^/]+)$/,
    handler: async (req, res, [userId]) => {
      const body = await readJsonBody(req);
      const availability = await repository.setAvailability(userId, body);
      sendJson(res, 200, availability);
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/availability\/([^/]+)$/,
    handler: async (req, res, [userId]) => {
      await repository.clearAvailability(userId);
      sendJson(res, 204, null);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/matches\/([^/]+)$/,
    handler: async (req, res, [userId]) => {
      const { self, candidates } = await repository.findNearbyCandidates(userId);
      if (!self) {
        return sendJson(res, 409, { error: 'nessuna disponibilità attiva per questo utente' });
      }
      sendJson(res, 200, { candidates });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/proposals$/,
    handler: async (req, res) => {
      const { userId, candidateId } = await readJsonBody(req);
      const { candidates } = await repository.findNearbyCandidates(userId);
      const match = candidates.find((c) => c.userId === candidateId);
      if (!match) {
        return sendJson(res, 409, {
          error: 'il candidato non è (più) tra le disponibilità reciproche',
        });
      }
      const proposal = await repository.createProposal(userId, candidateId, match.sharedInterests);
      sendJson(res, 201, { proposalId: proposal.id, status: proposal.status });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/proposals\/([^/]+)\/respond$/,
    handler: async (req, res, [proposalId]) => {
      const { userId, response } = await readJsonBody(req);
      if (!['accept', 'decline'].includes(response)) {
        return sendJson(res, 400, { error: "response deve essere 'accept' o 'decline'" });
      }
      const status = await repository.respondToProposal(proposalId, userId, response);
      sendJson(res, 200, status);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/proposals\/([^/]+)$/,
    handler: async (req, res, [proposalId], query) => {
      const status = await repository.getProposalStatusFor(proposalId, query.get('userId'));
      if (!status) return sendJson(res, 404, { error: 'proposta non trovata' });
      sendJson(res, 200, status);
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/tickets$/,
    handler: async (req, res) => {
      const { proposalId, userId, place, suggestedTime, icebreaker } = await readJsonBody(req);
      const proposal = await repository.getProposal(proposalId);
      if (!proposal || proposal.status !== 'matched') {
        return sendJson(res, 409, { error: 'il ticket richiede una proposta con doppio sì confermato' });
      }
      if (![proposal.user_a, proposal.user_b].includes(userId)) {
        return sendJson(res, 403, { error: 'utente non autorizzato per questa proposta' });
      }
      const existing = await repository.getTicketByProposal(proposalId);
      if (existing) return sendJson(res, 200, existing);

      const ticket = await repository.createTicket({
        proposalId,
        userA: proposal.user_a,
        userB: proposal.user_b,
        place,
        suggestedTime,
        icebreaker,
        code: generateMeetingCode(),
      });
      sendJson(res, 201, ticket);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/tickets\/([^/]+)$/,
    handler: async (req, res, [proposalId], query) => {
      const userId = query.get('userId');
      const proposal = await repository.getProposal(proposalId);
      if (!proposal || ![proposal.user_a, proposal.user_b].includes(userId)) {
        return sendJson(res, 404, { error: 'ticket non trovato' });
      }
      const ticket = await repository.getTicketByProposal(proposalId);
      if (!ticket) return sendJson(res, 404, { error: 'ticket non ancora creato' });
      sendJson(res, 200, ticket);
    },
  },
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  for (const route of routes) {
    if (route.method !== req.method) continue;
    const match = url.pathname.match(route.pattern);
    if (!match) continue;
    try {
      await route.handler(req, res, match.slice(1), url.searchParams);
    } catch (err) {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
      sendJson(res, status, { error: err.message });
    }
    return;
  }

  sendJson(res, 404, { error: 'rotta non trovata' });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Meelu backend in ascolto su http://localhost:${PORT}`);
  });
}

module.exports = server;
