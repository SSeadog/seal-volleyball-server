import { Schema, ArraySchema, type } from "@colyseus/schema";
import { Player } from "./Player";

/**
 * 로비 룸 상태
 */
export class LobbyRoomState extends Schema {
  @type("string") phase: string = "lobby";
  @type([Player]) players = new ArraySchema<Player>();
  @type("number") maxPlayers: number = 4;
  @type("string") roomId: string = "";
  @type("string") roomOwnerSessionId: string = "";
}


