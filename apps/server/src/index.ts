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
import { config } from "./config.js";
import { createWorker } from "./lib/mediasoup.js";
import { setupSocketHandler } from "./handlers/signaling.js";

const app = express();
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

let worker: mediasoup.types.Worker;

const startServer = async () => {
  try {
    worker = await createWorker();
    setupSocketHandler(peers, worker);

    server.listen(config.listenPort, config.listenIp, () => {
      console.log(
        `Server running at http://${config.listenIp}:${config.listenPort}`
      );
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
