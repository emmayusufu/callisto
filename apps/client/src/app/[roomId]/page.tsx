"use client";

import { useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { io, Socket } from "socket.io-client";
import {
  Device,
  types as mediasoupTypes,
} from "mediasoup-client";

export default function Room() {
  const params = useParams();
  const roomId = params.roomId as string;

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
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.style.width = "400px";
    video.style.background = "#000";

    const label = document.createElement("h3");
    label.textContent = "Remote";

    container.appendChild(label);
    container.appendChild(video);
    remoteVideosContainerRef.current.appendChild(container);
    remoteVideoRefs.current.set(producerId, video);
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

      // Create and load device
      const device = new Device();
      await device.load({ routerRtpCapabilities: rtpCapabilities });
      deviceRef.current = device;

      // Create send transport
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

        // Produce media
        const producer = await sendTransport.produce({ ...encodingParams, track });
        producer.on("trackended", () => console.log("Track ended"));
        producer.on("transportclose", () => console.log("Transport closed"));

        // Create receive transport
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

          // Consume existing producers
          for (const producerId of data.existingProducers) {
            await consumeProducer(socket, device, recvTransport, producerId);
          }

          // Listen for new producers
          socket.on("newProducer", async ({ producerId }) => {
            await consumeProducer(socket, device, recvTransport, producerId);
          });

          // Handle producer removal
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
    alert("Room link copied to clipboard!");
  };

  return (
    <main style={{ padding: "20px" }}>
      <div style={{ marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px" }}>
        <h2>Room: {roomId}</h2>
        <button onClick={copyRoomLink} style={{ padding: "8px 16px", cursor: "pointer" }}>
          Copy Link
        </button>
      </div>
      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
        <div>
          <h3>You</h3>
          <video ref={videoRef} autoPlay playsInline muted style={{ width: "400px", background: "#000" }} />
        </div>
        <div ref={remoteVideosContainerRef} style={{ display: "flex", gap: "20px", flexWrap: "wrap" }} />
      </div>
    </main>
  );
}
