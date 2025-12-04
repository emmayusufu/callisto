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
    <main style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <p>Creating room...</p>
    </main>
  );
}
