import mediasoup from "mediasoup";
import { Room } from "../types.js";
import { config } from "../config.js";

export const rooms = new Map<string, Room>();
/**
 * Note that peerRooms is a map of socketId to roomId
 * This is used to track which room a peer is in
*/
export const peerRooms = new Map<string, string>();

export const getOrCreateRoom = async (
  roomId: string,
  worker: mediasoup.types.Worker
): Promise<Room> => {
  let room = rooms.get(roomId);
  
  if (!room) {
    const router = await worker.createRouter({
      mediaCodecs: config.mediasoup.router.mediaCodecs,
    });
    
    room = {
      router,
      peers: new Map(),
    };
    
    rooms.set(roomId, room);
    console.log(`Created room: ${roomId}`);
  }
  
  return room;
};

export const getRoomByPeerId = (peerId: string): Room | undefined => {
  const roomId = peerRooms.get(peerId);
  return roomId ? rooms.get(roomId) : undefined;
};
