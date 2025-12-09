import mediasoup from "mediasoup";
import { config } from "../config.js";

export const createWorker = async (): Promise<mediasoup.types.Worker> => {
  const worker = await mediasoup.createWorker({
    rtcMinPort: config.mediasoup.worker.rtcMinPort,
    rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
    logLevel: config.mediasoup.worker.logLevel as mediasoup.types.WorkerLogLevel,
    logTags: config.mediasoup.worker.logTags as unknown as mediasoup.types.WorkerLogTag[],
  });

  console.log(`Worker process ID ${worker.pid}`);

  worker.on("died", (error) => {
    console.error("mediasoup worker has died");
    setTimeout(() => process.exit(1), 2000);
  });

  return worker;
};

export const createWebRtcTransport = async (router: mediasoup.types.Router) => {
  const transport = await router.createWebRtcTransport({
    listenIps: config.mediasoup.webRtcTransport.listenIps as unknown as mediasoup.types.TransportListenInfo[],
    enableUdp: config.mediasoup.webRtcTransport.enableUdp,
    enableTcp: config.mediasoup.webRtcTransport.enableTcp,
    preferUdp: config.mediasoup.webRtcTransport.preferUdp,
    initialAvailableOutgoingBitrate: config.mediasoup.webRtcTransport.initialAvailableOutgoingBitrate,
  });

  transport.on("dtlsstatechange", (dtlsState) => {
    if (dtlsState === "closed") {
      transport.close();
    }
  });

  return transport;
};
