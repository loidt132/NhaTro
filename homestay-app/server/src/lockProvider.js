// Abstraction over "card issued at check-in / revoked at check-out" so the
// booking flow never talks to a lock vendor directly. Swap MockLockProvider
// for TTLockProvider once TTLOCK_CLIENT_ID / TTLOCK_CLIENT_SECRET are set —
// nothing in index.js has to change.

import crypto from "node:crypto";
import fetch from "node-fetch";

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

// Real TTLock Open Platform integration (https://euopen.ttlock.com, or
// https://api.ttlock.com for non-EU accounts — set TTLOCK_BASE_URL to override).
//
// TTLock has no "virtual card issued remotely" API — a physical IC card still
// has to be swiped once at the lock for TTLock to learn its card number. What
// this issues instead is a temporary numeric *passcode* (keyboardPwd) valid
// only for [validFrom, validTo], which the guest types on the lock's keypad —
// functionally the same "access credential per stay" contract index.js wants.
// The returned id is stored in the same `cardId` field index.js already uses.
//
// Endpoint shapes below come from TTLock's open-platform docs and several
// independent third-party client implementations that agree on them; they are
// not hand-verified against a live account. If a call starts failing, check
// the current docs at https://open.ttlock.com before assuming the code is
// wrong.
class TTLockProvider {
  constructor({ clientId, clientSecret, username, password, baseUrl }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.username = username;
    this.password = password;
    this.baseUrl = (baseUrl || "https://euopen.ttlock.com").replace(/\/+$/, "");

    this._accessToken = null;
    this._refreshToken = null;
    this._tokenExpiresAt = 0; // epoch ms
  }

  static md5(value) {
    return crypto.createHash("md5").update(value, "utf8").digest("hex");
  }

  async _request(path, params, { method = "POST" } = {}) {
    const url = new URL(this.baseUrl + path);
    const body = new URLSearchParams(params);

    const res = await fetch(method === "GET" ? `${url}?${body}` : url, {
      method,
      headers: method === "GET" ? undefined : { "Content-Type": "application/x-www-form-urlencoded" },
      body: method === "GET" ? undefined : body,
    });

    if (!res.ok) {
      throw new Error(`TTLock ${path} HTTP ${res.status}`);
    }
    const data = await res.json();
    // TTLock errors come back as HTTP 200 with an `errcode` != 0.
    if (data && typeof data.errcode === "number" && data.errcode !== 0) {
      throw new Error(`TTLock ${path} error ${data.errcode}: ${data.errmsg || "unknown error"}`);
    }
    return data;
  }

  // One-time setup, not called on every request: registers TTLOCK_USERNAME as
  // a TTLock API user under this app's clientId. Call this yourself (e.g. from
  // a one-off script) before the first real issueCard/revokeCard call; TTLock
  // returns an error if the username is already registered, which is fine to
  // ignore.
  async registerUser({ username, password } = {}) {
    return this._request("/v3/user/register", {
      clientId: this.clientId,
      username: username || this.username,
      password: TTLockProvider.md5(password || this.password),
      date: Date.now(),
    });
  }

  async _ensureToken() {
    if (this._accessToken && Date.now() < this._tokenExpiresAt - 60_000) {
      return this._accessToken;
    }
    if (this._refreshToken) {
      try {
        return await this._refreshAccessToken();
      } catch (err) {
        console.warn(`[lockProvider:ttlock] token refresh failed (${err.message}), re-authenticating`);
      }
    }
    return this._passwordLogin();
  }

  async _passwordLogin() {
    const data = await this._request("/oauth2/token", {
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      username: this.username,
      password: TTLockProvider.md5(this.password),
      grant_type: "password",
    });
    this._storeToken(data);
    return this._accessToken;
  }

  async _refreshAccessToken() {
    const data = await this._request("/oauth2/token", {
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      grant_type: "refresh_token",
      refresh_token: this._refreshToken,
    });
    this._storeToken(data);
    return this._accessToken;
  }

  _storeToken(data) {
    this._accessToken = data.access_token;
    this._refreshToken = data.refresh_token;
    this._tokenExpiresAt = Date.now() + Number(data.expires_in || 0) * 1000;
  }

  async _authedRequest(path, params) {
    const accessToken = await this._ensureToken();
    return this._request(path, {
      clientId: this.clientId,
      accessToken,
      date: Date.now(),
      ...params,
    });
  }

  async issueCard({ lockId, validFrom, validTo }) {
    const data = await this._authedRequest("/v3/keyboardPwd/get", {
      lockId,
      keyboardPwdType: 3, // 3 = valid only within [startDate, endDate]
      keyboardPwdVersion: 2,
      startDate: new Date(validFrom).getTime(),
      endDate: new Date(validTo).getTime(),
    });
    // { keyboardPwdId, keyboardPwd }
    return { cardId: String(data.keyboardPwdId), passcode: data.keyboardPwd, provider: "ttlock" };
  }

  async revokeCard({ lockId, cardId }) {
    await this._authedRequest("/v3/keyboardPwd/delete", {
      lockId,
      keyboardPwdId: cardId,
      deleteType: 2, // 2 = delete via gateway/WiFi, no Bluetooth proximity needed
    });
    return { revoked: true };
  }

  async pollEvents({ lockId, since }) {
    const data = await this._authedRequest("/v3/lockRecord/list", {
      lockId,
      startDate: since ? new Date(since).getTime() : 0,
      pageNo: 1,
      pageSize: 100,
    });
    return data.list || [];
  }
}

export function createLockProvider() {
  const { TTLOCK_CLIENT_ID, TTLOCK_CLIENT_SECRET, TTLOCK_USERNAME, TTLOCK_PASSWORD, TTLOCK_BASE_URL } = process.env;
  if (TTLOCK_CLIENT_ID && TTLOCK_CLIENT_SECRET) {
    return new TTLockProvider({
      clientId: TTLOCK_CLIENT_ID,
      clientSecret: TTLOCK_CLIENT_SECRET,
      username: TTLOCK_USERNAME,
      password: TTLOCK_PASSWORD,
      baseUrl: TTLOCK_BASE_URL,
    });
  }
  return new MockLockProvider();
}

export { TTLockProvider, MockLockProvider };
