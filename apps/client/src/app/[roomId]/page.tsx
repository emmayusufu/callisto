"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useParams } from "next/navigation";
import { io, Socket } from "socket.io-client";
import {
  Device,
  types as mediasoupTypes,
} from "mediasoup-client";

export default function Room() {
  const params = useParams();
  const roomId = params.roomId as string;
  const [participantCount, setParticipantCount] = useState(1);
  const [copied, setCopied] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const remoteVideosContainerRef = useRef<HTMLDivElement | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const producerTransportRef = useRef<mediasoupTypes.Transport | null>(null);
  const consumerTransportRef = useRef<mediasoupTypes.Transport | null>(null);
  const consumersRef = useRef<Map<string, mediasoupTypes.Consumer>>(new Map());

  const encodingParams = {
    encoding: [
      { rid: "r0", maxBitrate: 100000, scalabilityMode: "S1T3" },
      { rid: "r1", maxBitrate: 300000, scalabilityMode: "S1T3" },
      { rid: "r2", maxBitrate: 900000, scalabilityMode: "S1T3" },
    ],
    codecOptions: { videoGoogleStartBitrate: 1000 },
  };

  const createVideoElement = useCallback((producerId: string, stream: MediaStream) => {
    if (!remoteVideosContainerRef.current) return;

    const existing = remoteVideoRefs.current.get(producerId);
    if (existing) {
      existing.srcObject = stream;
      return;
    }

    const container = document.createElement("div");
    container.style.cssText = "position: relative;";
    
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.style.cssText = "width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: 16px; background: #0f0f23; box-shadow: 0 4px 24px rgba(0,0,0,0.3);";

    const label = document.createElement("div");
    label.textContent = "Participant";
    label.style.cssText = "position: absolute; bottom: 12px; left: 12px; background: rgba(0,0,0,0.6); color: white; padding: 6px 14px; border-radius: 8px; font-size: 14px; font-weight: 500; backdrop-filter: blur(4px);";

    container.appendChild(video);
    container.appendChild(label);
    remoteVideosContainerRef.current.appendChild(container);
    remoteVideoRefs.current.set(producerId, video);
    setParticipantCount(prev => prev + 1);
  }, []);

  const consumeProducer = useCallback(async (
    socket: Socket,
    device: Device,
    recvTransport: mediasoupTypes.Transport,
    producerId: string
  ) => {
    socket.emit("consumeMedia", {
      rtpCapabilities: device.rtpCapabilities,
      producerId,
    }, async ({ params }: any) => {
      if (params.error) {
        console.log("Cannot consume:", params.error);
        return;
      }

      const consumer = await recvTransport.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
      });

      consumersRef.current.set(producerId, consumer);
      createVideoElement(producerId, new MediaStream([consumer.track]));

      socket.emit("resumePausedConsumer", { consumerId: consumer.id });
    });
  }, [createVideoElement]);

  const joinRoom = useCallback(async (socket: Socket, track: MediaStreamTrack) => {
    socket.emit("joinRoom", { roomId }, async (data: any) => {
      if (data.error) {
        console.error("Failed to join room:", data.error);
        return;
      }

      const rtpCapabilities = data.routerRtpCapabilities;

      const device = new Device();
      await device.load({ routerRtpCapabilities: rtpCapabilities });
      deviceRef.current = device;

      socket.emit("createTransport", { sender: true }, async ({ params }: any) => {
        if (params.error) {
          console.error("Create send transport error:", params.error);
          return;
        }

        const sendTransport = device.createSendTransport(params);
        producerTransportRef.current = sendTransport;

        sendTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
          try {
            socket.emit("connectProducerTransport", { dtlsParameters });
            callback();
          } catch (error: any) {
            errback(error);
          }
        });

        sendTransport.on("produce", async (parameters, callback, errback) => {
          try {
            socket.emit("transport-produce", {
              kind: parameters.kind,
              rtpParameters: parameters.rtpParameters,
            }, ({ id }: any) => callback({ id }));
          } catch (error: any) {
            errback(error);
          }
        });

        const producer = await sendTransport.produce({ ...encodingParams, track });
        producer.on("trackended", () => console.log("Track ended"));
        producer.on("transportclose", () => console.log("Transport closed"));

        socket.emit("createTransport", { sender: false }, async ({ params }: any) => {
          if (params.error) {
            console.error("Create recv transport error:", params.error);
            return;
          }

          const recvTransport = device.createRecvTransport(params);
          consumerTransportRef.current = recvTransport;

          recvTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
            try {
              socket.emit("connectConsumerTransport", { dtlsParameters });
              callback();
            } catch (error: any) {
              errback(error);
            }
          });

          for (const producerId of data.existingProducers) {
            await consumeProducer(socket, device, recvTransport, producerId);
          }

          socket.on("newProducer", async ({ producerId }) => {
            await consumeProducer(socket, device, recvTransport, producerId);
          });

          socket.on("producerClosed", ({ producerId }) => {
            const consumer = consumersRef.current.get(producerId);
            if (consumer) {
              consumer.close();
              consumersRef.current.delete(producerId);
            }
            const video = remoteVideoRefs.current.get(producerId);
            if (video) {
              video.parentElement?.remove();
              remoteVideoRefs.current.delete(producerId);
            }
            setParticipantCount(prev => Math.max(1, prev - 1));
          });
        });
      });
    });
  }, [roomId, consumeProducer]);

  useEffect(() => {
    const socket = io("http://localhost:4000/mediasoup");
    socketRef.current = socket;

    socket.on("connection-success", async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const track = stream.getVideoTracks()[0];

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        await joinRoom(socket, track);
      } catch (error) {
        console.error("Error accessing camera:", error);
      }
    });

    return () => {
      producerTransportRef.current?.close();
      consumerTransportRef.current?.close();
      consumersRef.current.forEach((consumer) => consumer.close());
      socket.disconnect();
    };
  }, [joinRoom]);

  const copyRoomLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
      padding: "24px",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      {/* Header */}
      <header style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "24px",
        padding: "16px 24px",
        background: "rgba(255,255,255,0.05)",
        borderRadius: "16px",
        backdropFilter: "blur(10px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <h1 style={{ 
            margin: 0, 
            fontSize: "24px", 
            fontWeight: 700,
            background: "linear-gradient(90deg, #667eea 0%, #764ba2 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>
            Callisto
          </h1>
          <div style={{
            padding: "6px 12px",
            background: "rgba(102, 126, 234, 0.2)",
            borderRadius: "20px",
            fontSize: "14px",
            color: "#a5b4fc",
          }}>
            {participantCount} participant{participantCount !== 1 ? 's' : ''}
          </div>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{
            padding: "8px 16px",
            background: "rgba(255,255,255,0.1)",
            borderRadius: "8px",
            fontSize: "14px",
            color: "#94a3b8",
            fontFamily: "monospace",
          }}>
            {roomId}
          </div>
          <button 
            onClick={copyRoomLink}
            style={{
              padding: "10px 20px",
              background: copied ? "#10b981" : "linear-gradient(90deg, #667eea 0%, #764ba2 100%)",
              border: "none",
              borderRadius: "8px",
              color: "white",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s ease",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            {copied ? "✓ Copied!" : "Share Link"}
          </button>
        </div>
      </header>

      {/* Video Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: participantCount === 1 ? "1fr" : "repeat(auto-fit, minmax(400px, 1fr))",
        gap: "16px",
        maxWidth: participantCount === 1 ? "800px" : "100%",
        margin: "0 auto",
      }}>
        {/* Local Video */}
        <div style={{ position: "relative" }}>
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted 
            style={{
              width: "100%",
              aspectRatio: "16/9",
              objectFit: "cover",
              borderRadius: "16px",
              background: "#0f0f23",
              transform: "scaleX(-1)",
              boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
            }} 
          />
          <div style={{
            position: "absolute",
            bottom: "12px",
            left: "12px",
            background: "rgba(0,0,0,0.6)",
            color: "white",
            padding: "6px 14px",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: 500,
            backdropFilter: "blur(4px)",
          }}>
            You
          </div>
        </div>
        
        {/* Remote Videos Container */}
        <div 
          ref={remoteVideosContainerRef} 
          style={{
            display: "contents",
          }}
        />
      </div>

      {/* Footer hint */}
      {participantCount === 1 && (
        <p style={{
          textAlign: "center",
          color: "#64748b",
          marginTop: "32px",
          fontSize: "15px",
        }}>
          Share the link above to invite others to this room
        </p>
      )}
    </main>
  );
}
