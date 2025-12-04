/**
 * @module index
 * This module sets up the Socket.IO server and initializes the mediasoup components
 * necessary for media transport with room support.
 */

import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import mediasoup from "mediasoup";

const app = express();
const port = 4000;
const server = http.createServer(app);

app.use(
  cors({
    origin: "*",
    credentials: true,
  })
);

const io = new Server(server, {
  cors: {
    origin: "*",
    credentials: true,
  },
});

const peers = io.of("/mediasoup");

let worker: mediasoup.types.Worker<mediasoup.types.AppData>;

interface Peer {
  socket: any;
  roomId: string;
  producerTransport?: mediasoup.types.WebRtcTransport;
  consumerTransport?: mediasoup.types.WebRtcTransport;
  producer?: mediasoup.types.Producer;
  consumers: Map<string, mediasoup.types.Consumer>;
}

interface Room {
  router: mediasoup.types.Router;
  peers: Map<string, Peer>;
}

const rooms = new Map<string, Room>();
const peerRooms = new Map<string, string>(); // socketId -> roomId

const createWorker = async (): Promise<mediasoup.types.Worker<mediasoup.types.AppData>> => {
  const newWorker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2100,
  });

  console.log(`Worker process ID ${newWorker.pid}`);

  newWorker.on("died", (error) => {
    console.error("mediasoup worker has died");
    setTimeout(() => process.exit(), 2000);
  });

  return newWorker;
};

worker = await createWorker();

const mediaCodecs: mediasoup.types.RtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
    preferredPayloadType: 96,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    preferredPayloadType: 97,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];

const getOrCreateRoom = async (roomId: string): Promise<Room> => {
  let room = rooms.get(roomId);
  if (!room) {
    const router = await worker.createRouter({ mediaCodecs });
    room = {
      router,
      peers: new Map(),
    };
    rooms.set(roomId, room);
    console.log(`Created room: ${roomId}`);
  }
  return room;
};

const createWebRtcTransport = async (router: mediasoup.types.Router) => {
  const transport = await router.createWebRtcTransport({
    listenIps: [{ ip: "127.0.0.1" }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });

  transport.on("dtlsstatechange", (dtlsState) => {
    if (dtlsState === "closed") {
      transport.close();
    }
  });

  return transport;
};

peers.on("connection", async (socket) => {
  console.log(`Peer connected: ${socket.id}`);
  socket.emit("connection-success", { socketId: socket.id });

  socket.on("disconnect", () => {
    console.log(`Peer disconnected: ${socket.id}`);
    const roomId = peerRooms.get(socket.id);
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        const peer = room.peers.get(socket.id);
        if (peer) {
          // Notify others that producer is gone
          if (peer.producer) {
            socket.to(roomId).emit("producerClosed", { producerId: peer.producer.id });
            peer.producer.close();
          }
          peer.producerTransport?.close();
          peer.consumerTransport?.close();
          peer.consumers.forEach((consumer) => consumer.close());
          room.peers.delete(socket.id);
        }
        // Clean up empty rooms
        if (room.peers.size === 0) {
          room.router.close();
          rooms.delete(roomId);
          console.log(`Room deleted: ${roomId}`);
        }
      }
      peerRooms.delete(socket.id);
    }
  });

  socket.on("joinRoom", async ({ roomId }, callback) => {
    try {
      const room = await getOrCreateRoom(roomId);
      
      const peer: Peer = {
        socket,
        roomId,
        consumers: new Map(),
      };
      room.peers.set(socket.id, peer);
      peerRooms.set(socket.id, roomId);
      
      socket.join(roomId);

      // Get existing producers in the room
      const existingProducers: string[] = [];
      room.peers.forEach((p, peerId) => {
        if (peerId !== socket.id && p.producer) {
          existingProducers.push(p.producer.id);
        }
      });

      callback({
        routerRtpCapabilities: room.router.rtpCapabilities,
        existingProducers,
      });
    } catch (error) {
      console.error("Error joining room:", error);
      callback({ error: "Failed to join room" });
    }
  });

  socket.on("getRouterRtpCapabilities", (callback) => {
    const roomId = peerRooms.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (room) {
      callback({ routerRtpCapabilities: room.router.rtpCapabilities });
    }
  });

  socket.on("createTransport", async ({ sender }, callback) => {
    const roomId = peerRooms.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    const peer = room?.peers.get(socket.id);

    if (!room || !peer) {
      callback({ params: { error: "Not in a room" } });
      return;
    }

    try {
      const transport = await createWebRtcTransport(room.router);

      if (sender) {
        peer.producerTransport = transport;
      } else {
        peer.consumerTransport = transport;
      }

      callback({
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        },
      });
    } catch (error) {
      callback({ params: { error } });
    }
  });

  socket.on("connectProducerTransport", async ({ dtlsParameters }) => {
    const roomId = peerRooms.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    const peer = room?.peers.get(socket.id);
    await peer?.producerTransport?.connect({ dtlsParameters });
  });

  socket.on("transport-produce", async ({ kind, rtpParameters }, callback) => {
    const roomId = peerRooms.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    const peer = room?.peers.get(socket.id);

    if (!peer?.producerTransport) {
      callback({ error: "No producer transport" });
      return;
    }

    const producer = await peer.producerTransport.produce({ kind, rtpParameters });
    peer.producer = producer;

    producer.on("transportclose", () => {
      producer.close();
    });

    // Notify other peers in the room
    socket.to(roomId!).emit("newProducer", { producerId: producer.id });

    callback({ id: producer.id });
  });

  socket.on("connectConsumerTransport", async ({ dtlsParameters }) => {
    const roomId = peerRooms.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    const peer = room?.peers.get(socket.id);
    await peer?.consumerTransport?.connect({ dtlsParameters });
  });

  socket.on("consumeMedia", async ({ rtpCapabilities, producerId }, callback) => {
    const roomId = peerRooms.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    const peer = room?.peers.get(socket.id);

    if (!room || !peer?.consumerTransport) {
      callback({ params: { error: "Not ready to consume" } });
      return;
    }

    // Find the producer
    let targetProducer: mediasoup.types.Producer | undefined;
    room.peers.forEach((p) => {
      if (p.producer?.id === producerId) {
        targetProducer = p.producer;
      }
    });

    if (!targetProducer) {
      callback({ params: { error: "Producer not found" } });
      return;
    }

    if (!room.router.canConsume({ producerId, rtpCapabilities })) {
      callback({ params: { error: "Cannot consume" } });
      return;
    }

    try {
      const consumer = await peer.consumerTransport.consume({
        producerId,
        rtpCapabilities,
        paused: targetProducer.kind === "video",
      });

      peer.consumers.set(producerId, consumer);

      consumer.on("transportclose", () => consumer.close());
      consumer.on("producerclose", () => {
        consumer.close();
        peer.consumers.delete(producerId);
      });

      callback({
        params: {
          producerId,
          id: consumer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        },
      });
    } catch (error) {
      callback({ params: { error } });
    }
  });

  socket.on("resumePausedConsumer", async ({ consumerId }) => {
    const roomId = peerRooms.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    const peer = room?.peers.get(socket.id);

    if (peer) {
      peer.consumers.forEach(async (consumer) => {
        if (consumer.id === consumerId) {
          await consumer.resume();
        }
      });
    }
  });
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
