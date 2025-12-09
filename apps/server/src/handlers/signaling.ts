import { Server, Socket } from "socket.io";
import mediasoup from "mediasoup";
import { Peer } from "../types.js";
import { createWebRtcTransport } from "../lib/mediasoup.js";
import { rooms, peerRooms, getOrCreateRoom, getRoomByPeerId } from "../lib/rooms.js";

export const setupSocketHandler = (io: Server | any, worker: mediasoup.types.Worker) => {
  io.on("connection", async (socket: Socket) => {
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
        const room = await getOrCreateRoom(roomId, worker);
        
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
      const room = getRoomByPeerId(socket.id);
      if (room) {
        callback({ routerRtpCapabilities: room.router.rtpCapabilities });
      }
    });

    socket.on("createTransport", async ({ sender }, callback) => {
      const room = getRoomByPeerId(socket.id);
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
      const room = getRoomByPeerId(socket.id);
      const peer = room?.peers.get(socket.id);
      await peer?.producerTransport?.connect({ dtlsParameters });
    });

    socket.on("transport-produce", async ({ kind, rtpParameters }, callback) => {
      const room = getRoomByPeerId(socket.id);
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
      socket.to(peer.roomId).emit("newProducer", { producerId: producer.id });

      callback({ id: producer.id });
    });

    socket.on("connectConsumerTransport", async ({ dtlsParameters }) => {
      const room = getRoomByPeerId(socket.id);
      const peer = room?.peers.get(socket.id);
      await peer?.consumerTransport?.connect({ dtlsParameters });
    });

    socket.on("consumeMedia", async ({ rtpCapabilities, producerId }, callback) => {
      const room = getRoomByPeerId(socket.id);
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
      const room = getRoomByPeerId(socket.id);
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
};
