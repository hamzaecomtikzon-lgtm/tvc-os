/* Accounts and sessions. Passwords are stored as scrypt digests; sessions are HttpOnly cookies. */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { sql } from "./store.js";

const COOKIE = "kreo_session";
const SESSION_DAYS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;

const q = {
  byEmail: sql.prepare("SELECT * FROM users WHERE email = ?"),
  insert: sql.prepare("INSERT INTO users (id, email, name, brand, provider, salt, hash, created_at, workspace_id, role) VALUES (?, ?, ?, ?, 'password', ?, ?, ?, ?, ?)"),
  insertGoogle: sql.prepare("INSERT INTO users (id, email, name, brand, provider, created_at, workspace_id, role) VALUES (?, ?, ?, ?, 'google', ?, ?, ?)"),
  rename: sql.prepare("UPDATE users SET name = ?, brand = ? WHERE id = ?"),
  rebrand: sql.prepare("UPDATE users SET brand = ? WHERE workspace_id = ?"),
  team: sql.prepare("SELECT id, name, email, role, workspace_id FROM users WHERE id = ? OR workspace_id = ? ORDER BY workspace_id IS NOT NULL, created_at"),
  invite: sql.prepare("SELECT * FROM invites WHERE email = ?"),
  invites: sql.prepare("SELECT email, role FROM invites WHERE workspace_id = ? ORDER BY created_at"),
  addInvite: sql.prepare("INSERT INTO invites (email, workspace_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO UPDATE SET role = excluded.role, workspace_id = excluded.workspace_id"),
  dropInvite: sql.prepare("DELETE FROM invites WHERE email = ? AND workspace_id = ?"),
  setRole: sql.prepare("UPDATE users SET role = ? WHERE email = ? AND workspace_id = ?"),
  detach: sql.prepare("DELETE FROM users WHERE email = ? AND workspace_id = ?"),
  dropSessions: sql.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ? AND workspace_id = ?)"),
  session: sql.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"),
  addSession: sql.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)"),
  dropSession: sql.prepare("DELETE FROM sessions WHERE token_hash = ?"),
  prune: sql.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
};

const fail = (status, code, field, message) => Object.assign(new Error(message), { status, code, field });
const sha = (s) => createHash("sha256").update(s).digest("hex");
const digest = (salt, password) => scryptSync(password, salt, 64).toString("hex");
// `workspace` is whose data the user works in: their own, or the owner's when they were invited.
const publicUser = (u) => ({
  id: u.id, name: u.name, brand: u.brand, email: u.email, provider: u.provider,
  workspace: u.workspace_id || u.id, role: u.workspace_id ? u.role : "Owner", createdAt: u.created_at,
});
export const ROLES = ["Admin", "Moderator", "Viewer"];

function readCookie(req) {
  const m = (req.headers.cookie || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([a-f0-9]+)"));
  return m ? m[1] : "";
}

function startSession(res, user) {
  const token = randomBytes(32).toString("hex");
  q.prune.run(Date.now());
  q.addSession.run(sha(token), user.id, Date.now() + SESSION_DAYS * 864e5);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  return publicUser(user);
}

export const auth = {
  /** The signed-in user for a request, or null. */
  user(req) {
    const token = readCookie(req);
    const u = token && q.session.get(sha(token), Date.now());
    return u ? publicUser(u) : null;
  },

  signUp(res, { name, brand, email, password }) {
    name = String(name || "").trim();
    brand = String(brand || "").trim();
    email = String(email || "").trim().toLowerCase();
    password = String(password || "");
    if (!name) throw fail(400, "invalid", "name", "Enter your name.");
    const invite = q.invite.get(email); // invited people join that workspace and take its brand
    if (!brand && !invite) throw fail(400, "invalid", "brand", "Enter your brand name.");
    if (!EMAIL_RE.test(email)) throw fail(400, "invalid", "email", "Enter a valid email, like jordan@glowlab.co.");
    if (password.length < MIN_PASSWORD) throw fail(400, "invalid", "password", `Use at least ${MIN_PASSWORD} characters.`);
    if (q.byEmail.get(email)) throw fail(409, "email_taken", "email", "An account with this email already exists. Sign in instead.");
    const salt = randomBytes(16).toString("hex");
    const owner = invite && q.team.all(invite.workspace_id, invite.workspace_id)[0];
    if (owner) brand = sql.prepare("SELECT brand FROM users WHERE id = ?").get(owner.id).brand;
    const user = {
      id: randomBytes(12).toString("hex"), email, name, brand, provider: "password", created_at: new Date().toISOString(),
      workspace_id: owner ? invite.workspace_id : null, role: owner ? invite.role : "Owner",
    };
    q.insert.run(user.id, email, name, brand, salt, digest(salt, password), user.created_at, user.workspace_id, user.role);
    if (invite) q.dropInvite.run(email, invite.workspace_id);
    return startSession(res, user);
  },

  signIn(res, { email, password }) {
    const u = q.byEmail.get(String(email || "").trim().toLowerCase());
    // Same message for an unknown email and a wrong password.
    const ok = u?.hash && timingSafeEqual(Buffer.from(digest(u.salt, String(password || "")), "hex"), Buffer.from(u.hash, "hex"));
    if (!ok) throw fail(401, "invalid_credentials", "password", "That email and password don’t match. Check both and try again.");
    return startSession(res, u);
  },

  /** Change the signed-in user's name, and the brand name if they own the workspace. */
  update(user, { name, brand }) {
    name = String(name || "").trim().slice(0, 80);
    brand = user.role === "Owner" ? String(brand || "").trim().slice(0, 80) : user.brand;
    if (!name) throw fail(400, "invalid", "name", "Enter your name.");
    if (!brand) throw fail(400, "invalid", "brand", "Enter your brand name.");
    q.rename.run(name, brand, user.id);
    if (user.role === "Owner") q.rebrand.run(brand, user.id);
    return { ...user, name, brand };
  },

  /** Everyone in a workspace, and the invitations that haven't been taken up. */
  team(ws) {
    return {
      members: q.team.all(ws, ws).map((u) => ({ name: u.name, email: u.email, role: u.workspace_id ? u.role : "Owner" })),
      invites: q.invites.all(ws),
    };
  },

  /** Invite someone by email. They join this workspace when they sign up with that address. */
  invite(ws, { email, role }) {
    email = String(email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw fail(400, "invalid", "email", "Enter a valid email address.");
    if (!ROLES.includes(role)) throw fail(400, "invalid", "role", "Pick a role.");
    if (q.byEmail.get(email)) throw fail(409, "email_taken", "email", "That person already has a Kreo account, so they can’t be added to this one.");
    q.addInvite.run(email, ws, role, new Date().toISOString());
  },

  setRole(ws, email, role) {
    if (!ROLES.includes(role)) throw fail(400, "invalid", "role", "Pick a role.");
    q.setRole.run(role, email, ws);
    sql.prepare("UPDATE invites SET role = ? WHERE email = ? AND workspace_id = ?").run(role, email, ws);
  },

  /** Remove a member (their account is deleted) or cancel an invitation. */
  remove(ws, email) {
    q.dropSessions.run(email, ws);
    q.detach.run(email, ws);
    q.dropInvite.run(email, ws);
  },

  /* ---------- Google sign-in (OAuth) ---------- */
  googleConfigured: () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),

  /** Where to send the browser to sign in with Google. Remembers a one-time `state` in a cookie. */
  googleUrl(res, redirectUri) {
    if (!auth.googleConfigured()) throw fail(503, "google_off", null, "Google sign-in isn’t set up yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to backend/.env (see backend/README.md), then restart the backend.");
    const state = randomBytes(16).toString("hex");
    res.setHeader("Set-Cookie", `kreo_oauth=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);
    return "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: "code", scope: "openid email profile", state, prompt: "select_account",
    });
  },

  /** Finish Google sign-in: trade the code for the person's verified email, then sign them in (creating the account the first time). */
  async googleFinish(req, res, { code, state }, redirectUri) {
    const saved = (req.headers.cookie || "").match(/(?:^|;\s*)kreo_oauth=([a-f0-9]+)/)?.[1];
    if (!code || !state || state !== saved) throw fail(400, "google_failed", null, "Google sign-in didn’t finish. Try again.");
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    }).catch((e) => {
      console.error("[google sign-in] couldn't reach Google:", e.cause?.code || e.message);
      throw fail(502, "google_unreachable", null, "Couldn’t reach Google to finish signing in. Check the server’s internet connection and try again.");
    });
    const tok = await r.json().catch(() => ({}));
    if (!r.ok || !tok.id_token) throw fail(400, "google_failed", null, "Google didn’t accept the sign-in. Check the client ID, secret and redirect address.");
    // The token came straight from Google over HTTPS, so its contents can be read without checking the signature.
    const who = JSON.parse(Buffer.from(tok.id_token.split(".")[1], "base64url").toString("utf8"));
    const email = String(who.email || "").toLowerCase();
    if (who.aud !== process.env.GOOGLE_CLIENT_ID || !who.email_verified || !EMAIL_RE.test(email)) throw fail(400, "google_failed", null, "Google didn’t confirm your email address.");

    let user = q.byEmail.get(email);
    if (!user) {
      const invite = q.invite.get(email);
      const name = String(who.name || email.split("@")[0]).slice(0, 80);
      const domain = email.split("@")[1].split(".")[0];
      const personal = ["gmail", "googlemail", "outlook", "hotmail", "yahoo", "icloud", "proton"].includes(domain);
      let brand = personal ? `${name.split(" ")[0]}’s brand` : domain[0].toUpperCase() + domain.slice(1);
      if (invite) brand = sql.prepare("SELECT brand FROM users WHERE id = ?").get(invite.workspace_id)?.brand || brand;
      user = { id: randomBytes(12).toString("hex"), email, name, brand, provider: "google", created_at: new Date().toISOString(), workspace_id: invite?.workspace_id || null, role: invite?.role || "Owner" };
      q.insertGoogle.run(user.id, email, name, brand, user.created_at, user.workspace_id, user.role);
      if (invite) q.dropInvite.run(email, invite.workspace_id);
    }
    const out = startSession(res, user);
    // Two cookies in one response: the new session, and the used-up state cleared.
    res.setHeader("Set-Cookie", [res.getHeader("Set-Cookie"), "kreo_oauth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"].flat());
    return out;
  },

  signOut(req, res) {
    const token = readCookie(req);
    if (token) q.dropSession.run(sha(token));
    res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  },
};
