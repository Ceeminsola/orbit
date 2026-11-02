import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import Login from "./auth/Login";
import Brand from "./Brand";
import Capture from "./pages/Capture";
import Ea from "./pages/Ea";
import { configured, supabase } from "./lib/supabase";
function Shell() {
  const { session, role, loading } = useAuth();
  const [view, setView] = useState<"capture" | "ea">(location.hash === "#ea" ? "ea" : "capture");
  useEffect(() => { document.getElementById("root")?.classList.toggle("wide", view === "ea" && role === "ea"); }, [view, role]);
  if (!configured) return <div className="msg err">Orbit isn’t configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see README). Nothing can be saved until then.</div>;
  if (loading) return <p className="small">Loading…</p>;
  if (!session) return <><Brand /><Login /></>;
  if (!role) return <><Brand /><div className="msg warn">You’re signed in, but your account has no Orbit role yet. Ask your assistant to enable it.</div><button onClick={() => void supabase.auth.signOut()}>Sign out</button></>;
  return (<><Brand />
    <nav>{role === "ea" && <><button className={"tab" + (view === "capture" ? " on" : "")} onClick={() => setView("capture")}>Executive Capture</button><button className={"tab" + (view === "ea" ? " on" : "")} onClick={() => { setView("ea"); history.replaceState(null, "", "#ea"); }}>EA Command Inbox</button></>}
      <button style={{ marginLeft: "auto" }} onClick={() => void supabase.auth.signOut()}>Sign out</button></nav>
    {view === "ea" && role === "ea" ? <Ea /> : <Capture />}</>);
}
export default function App() { return <AuthProvider><Shell /></AuthProvider>; }
