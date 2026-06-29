import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import Auth from "./Auth.jsx";
import CosmicBackground from "./CosmicBackground.jsx";
import { supabase } from "./supabase.js";
import "./index.css";

function Root() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  return (
    <>
      <CosmicBackground />
      {/* 画面下部の暗いスクリム：背景の光に文字が負けないようにする */}
      <div
        className="fixed bottom-0 left-0 right-0 -z-[5] pointer-events-none"
        style={{ height: "32vh", background: "linear-gradient(to top, #050410 0%, rgba(5,4,16,0.6) 45%, transparent 100%)" }}
      />
      {session === undefined ? null : session ? <App session={session} /> : <Auth />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
