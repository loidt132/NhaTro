// Abstraction over "card issued at check-in / revoked at check-out" so the
// booking flow never talks to a lock vendor directly. Swap MockLockProvider
// for TTLockProvider once TTLOCK_CLIENT_ID / TTLOCK_CLIENT_SECRET are set —
// nothing in index.js has to change.

class MockLockProvider {
  async issueCard({ lockId, validFrom, validTo }) {
    const cardId = `mock-card-${Math.random().toString(36).slice(2, 10)}`;
    console.log(`[lockProvider:mock] issued card ${cardId} for lock ${lockId} (${validFrom} -> ${validTo})`);
    return { cardId, provider: "mock" };
  }

  async revokeCard({ lockId, cardId }) {
    console.log(`[lockProvider:mock] revoked card ${cardId} for lock ${lockId}`);
    return { revoked: true };
  }

  // In the real integration this polls TTLock's unlocking-records API.
  // Here the frontend's "Simulate swipe" button calls /api/stays/:id/simulate-swipe
  // directly instead, so this is a no-op kept for interface parity.
  async pollEvents() {
    return [];
  }
}

// Skeleton for the real TTLock Open Platform integration. Endpoint paths are
// illustrative — confirm the exact current paths against TTLock's open
// platform docs before wiring real credentials in.
class TTLockProvider {
  constructor({ clientId, clientSecret, username, password, baseUrl }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.username = username;
    this.password = password;
    this.baseUrl = baseUrl || "https://euopen.ttlock.com";
  }

  async issueCard({ lockId, validFrom, validTo }) {
    throw new Error(
      "TTLockProvider.issueCard not implemented yet — set TTLOCK_CLIENT_ID/SECRET and fill in the real API call"
    );
  }

  async revokeCard({ lockId, cardId }) {
    throw new Error("TTLockProvider.revokeCard not implemented yet");
  }

  async pollEvents({ lockId, since }) {
    throw new Error("TTLockProvider.pollEvents not implemented yet");
  }
}

export function createLockProvider() {
  const { TTLOCK_CLIENT_ID, TTLOCK_CLIENT_SECRET, TTLOCK_USERNAME, TTLOCK_PASSWORD } = process.env;
  if (TTLOCK_CLIENT_ID && TTLOCK_CLIENT_SECRET) {
    return new TTLockProvider({
      clientId: TTLOCK_CLIENT_ID,
      clientSecret: TTLOCK_CLIENT_SECRET,
      username: TTLOCK_USERNAME,
      password: TTLOCK_PASSWORD,
    });
  }
  return new MockLockProvider();
}
