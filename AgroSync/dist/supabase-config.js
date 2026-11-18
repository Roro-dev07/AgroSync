/** Public connection settings only. Database permissions are enforced by Supabase RLS. */
"use strict";
const AgroSyncBackend = (() => {
  const URL = "https://vthwllinprcweahbxqyu.supabase.co";
  const KEY = "sb_publishable_J3LpDzXDqTSh1INx7vOX_g_-mkD9hfL";
  const ADMIN_UID = "e7a38ce9-8104-4022-a137-8cca64113d2d";
  let client;
  function getClient() {
    if (!globalThis.supabase?.createClient) throw new Error("Supabase could not load. Check your internet connection and reload.");
    client ||= globalThis.supabase.createClient(URL, KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return client;
  }
  async function requireAdmin() {
    const { data, error } = await getClient().auth.getSession();
    if (error) throw new Error("Sign-in session could not be checked. Please sign in again.");
    if (!data.session) throw new Error("Administrator sign-in required.");
    if (data.session.user.id !== ADMIN_UID) throw new Error("This account is not authorized to manage AgroSync.");
    return data.session.user;
  }
  async function signIn(email, password) {
    const api = getClient();
    const { data, error } = await api.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(error.message);
    if (data.user?.id !== ADMIN_UID) {
      await api.auth.signOut({ scope: "local" });
      throw new Error("This account is not authorized to manage AgroSync.");
    }
    return data.user;
  }
  async function signOut() {
    const { error } = await getClient().auth.signOut({ scope: "local" });
    if (error) throw new Error(error.message);
  }
  function loginPath(page) {
    return "login.html?next=" + encodeURIComponent(["registration.html", "broadcast.html"].includes(page) ? page : "registration.html");
  }
  return Object.freeze({ getClient, requireAdmin, signIn, signOut, loginPath });
})();

