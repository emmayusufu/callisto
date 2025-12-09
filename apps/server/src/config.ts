import { types as mediasoupTypes } from "mediasoup";

export const mediaCodecs: mediasoupTypes.RtpCodecCapability[] = [
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

export const config = {
  listenIp: "0.0.0.0",
  listenPort: 4000,
  mediasoup: {
    worker: {
      rtcMinPort: 2000,
      rtcMaxPort: 2100,
      logLevel: "warn",
      logTags: [
        "info",
        "ice",
        "dtls",
        "rtp",
        "srtp",
        "rtcp",
        // "rtx",
        // "bwe",
        // "score",
        // "simulcast",
        // "svc",
        // "sctp",
      ],
    },
    router: {
      mediaCodecs,
    },
    webRtcTransport: {
      listenIps: [{ ip: "127.0.0.1" }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 1000000,
    },
  },
} as const;
