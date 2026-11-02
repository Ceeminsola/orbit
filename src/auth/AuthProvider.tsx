import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { Role } from "../types";
interface Ctx { session: Session | null; role: Role | null; loading: boolean }
const C = createContext<Ctx>({ session: null, role: null, loading: true });
export const useAuth = () => useContext(C);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); if (!s) { setRole(null); setLoading(false); } });
    return () => sub.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) return;
    void supabase.from("profiles").select("role").eq("id", session.user.id).maybeSingle<{ role: Role }>()
      .then(({ data }) => { setRole(data?.role ?? null); setLoading(false); });
  }, [session]);
  return <C.Provider value={{ session, role, loading }}>{children}</C.Provider>;
}
