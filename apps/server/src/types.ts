import { types as mediasoupTypes } from "mediasoup";

export interface Peer {
  socket: any;
  roomId: string;
  producerTransport?: mediasoupTypes.WebRtcTransport;
  consumerTransport?: mediasoupTypes.WebRtcTransport;
  producer?: mediasoupTypes.Producer;
  consumers: Map<string, mediasoupTypes.Consumer>;
}

export interface Room {
  router: mediasoupTypes.Router;
  peers: Map<string, Peer>;
}
