"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

function generateRoomId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const roomId = generateRoomId();
    router.replace(`/${roomId}`);
  }, [router]);

  return (
    <main style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{
          fontSize: "48px",
          fontWeight: 700,
          background: "linear-gradient(90deg, #667eea 0%, #764ba2 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          marginBottom: "16px",
        }}>
          Callisto
        </h1>
        <p style={{ color: "#64748b", fontSize: "18px" }}>Creating your room...</p>
      </div>
    </main>
  );
}
