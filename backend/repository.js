'use strict';

const { restRequest } = require('./db');
const { cellKey, neighborCells, isReciprocalMatch } = require('./matching');

const DEFAULT_RADIUS_M = 150;
const DEFAULT_AVAILABILITY_MINUTES = 45;
const PROPOSAL_TTL_MINUTES = 20;

function nowIso() {
  return new Date().toISOString();
}

// ---- users ----

async function createUser({ name, birthYear, interests, photoUrl }) {
  const [user] = await restRequest('POST', '/users', {
    body: {
      name,
      birth_year: birthYear,
      interests: interests || [],
      photo_url: photoUrl || null,
    },
  });
  return user;
}

async function getUser(userId) {
  const rows = await restRequest('GET', '/users', { query: { id: `eq.${userId}`, select: '*' } });
  return rows[0] || null;
}

async function updateUser(userId, patch) {
  const rows = await restRequest('PATCH', '/users', {
    query: { id: `eq.${userId}` },
    body: patch,
  });
  return rows[0] || null;
}

// ---- availability ----

async function setAvailability(userId, { lat, lng, radiusM, interests, ttlMinutes }) {
  const expiresAt = new Date(
    Date.now() + (ttlMinutes || DEFAULT_AVAILABILITY_MINUTES) * 60000
  ).toISOString();

  const row = {
    user_id: userId,
    lat,
    lng,
    radius_m: radiusM || DEFAULT_RADIUS_M,
    interests: interests || [],
    cell: cellKey(lat, lng),
    activated_at: nowIso(),
    expires_at: expiresAt,
  };

  const [availability] = await restRequest('POST', '/availability', {
    query: { on_conflict: 'user_id' },
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: row,
  });
  return availability;
}

async function clearAvailability(userId) {
  await restRequest('DELETE', '/availability', { query: { user_id: `eq.${userId}` } });
}

async function getAvailability(userId) {
  const rows = await restRequest('GET', '/availability', { query: { user_id: `eq.${userId}` } });
  return rows[0] || null;
}

// Restituisce solo id, distanza e interessi in comune: niente nome o foto in
// questa fase, per non trasformare la scoperta in uno "swipe" basato sull'aspetto.
async function findNearbyCandidates(userId) {
  const mine = await getAvailability(userId);
  if (!mine) return { self: null, candidates: [] };

  const cells = neighborCells(mine.lat, mine.lng);
  const rows = await restRequest('GET', '/availability', {
    query: {
      cell: `in.(${cells.join(',')})`,
      user_id: `neq.${userId}`,
      expires_at: `gt.${nowIso()}`,
      select: '*',
    },
  });

  const candidates = [];
  for (const other of rows) {
    const { isMatch, distance, sharedInterests } = isReciprocalMatch(mine, other);
    if (isMatch) {
      candidates.push({ userId: other.user_id, distanceMeters: distance, sharedInterests });
    }
  }
  candidates.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return { self: mine, candidates };
}

// ---- proposals ----

async function findOpenProposal(userA, userB) {
  const rows = await restRequest('GET', '/proposals', {
    query: {
      or: `(and(user_a.eq.${userA},user_b.eq.${userB}),and(user_a.eq.${userB},user_b.eq.${userA}))`,
      status: 'eq.open',
    },
  });
  return rows[0] || null;
}

async function createProposal(userA, userB, sharedInterestsList) {
  const existing = await findOpenProposal(userA, userB);
  if (existing) return existing;

  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MINUTES * 60000).toISOString();
  const [proposal] = await restRequest('POST', '/proposals', {
    body: {
      user_a: userA,
      user_b: userB,
      shared_interests: sharedInterestsList || [],
      expires_at: expiresAt,
    },
  });
  return proposal;
}

async function getProposal(proposalId) {
  const rows = await restRequest('GET', '/proposals', { query: { id: `eq.${proposalId}` } });
  return rows[0] || null;
}

async function getResponses(proposalId) {
  return restRequest('GET', '/proposal_responses', { query: { proposal_id: `eq.${proposalId}` } });
}

async function markProposalStatus(proposalId, status, matchId) {
  const [proposal] = await restRequest('PATCH', '/proposals', {
    query: { id: `eq.${proposalId}` },
    body: { status, match_id: matchId },
  });
  return proposal;
}

async function respondToProposal(proposalId, userId, response) {
  await restRequest('POST', '/proposal_responses', {
    query: { on_conflict: 'proposal_id,user_id' },
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: { proposal_id: proposalId, user_id: userId, response },
  });

  const proposal = await getProposal(proposalId);
  if (proposal && proposal.status === 'open') {
    const responses = await getResponses(proposalId);

    if (responses.some((r) => r.response === 'decline')) {
      await markProposalStatus(proposalId, 'closed', null);
    } else if (responses.length === 2 && responses.every((r) => r.response === 'accept')) {
      await markProposalStatus(proposalId, 'matched', proposalId);
    }
  }

  return getProposalStatusFor(proposalId, userId);
}

// Vista della proposta dal punto di vista di un singolo utente: un rifiuto
// altrui non è mai distinguibile da una proposta scaduta senza risposta.
async function getProposalStatusFor(proposalId, userId) {
  const proposal = await getProposal(proposalId);
  if (!proposal) return null;

  if (proposal.status === 'matched') {
    const otherUserId = proposal.user_a === userId ? proposal.user_b : proposal.user_a;
    const other = await getUser(otherUserId);
    return {
      status: 'matched',
      match: { userId: other.id, name: other.name, photoUrl: other.photo_url },
    };
  }

  if (proposal.status === 'closed') {
    const myResponse = (await getResponses(proposalId)).find((r) => r.user_id === userId);
    if (myResponse && myResponse.response === 'decline') {
      return { status: 'declined_by_me' };
    }
    return { status: 'expired' };
  }

  const myResponse = (await getResponses(proposalId)).find((r) => r.user_id === userId);
  return { status: myResponse ? 'waiting' : 'open' };
}

// ---- tickets (il "biglietto" con luogo, orario e codice di sicurezza) ----

async function createTicket({ proposalId, userA, userB, place, suggestedTime, icebreaker, code }) {
  const [ticket] = await restRequest('POST', '/tickets', {
    body: {
      proposal_id: proposalId,
      user_a: userA,
      user_b: userB,
      place,
      suggested_time: suggestedTime,
      icebreaker,
      code,
    },
  });
  return ticket;
}

async function getTicketByProposal(proposalId) {
  const rows = await restRequest('GET', '/tickets', { query: { proposal_id: `eq.${proposalId}` } });
  return rows[0] || null;
}

module.exports = {
  createUser,
  getUser,
  updateUser,
  setAvailability,
  clearAvailability,
  getAvailability,
  findNearbyCandidates,
  findOpenProposal,
  createProposal,
  getProposal,
  respondToProposal,
  getProposalStatusFor,
  createTicket,
  getTicketByProposal,
};
