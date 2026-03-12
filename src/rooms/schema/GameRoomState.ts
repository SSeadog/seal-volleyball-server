import { Schema, ArraySchema, type } from "@colyseus/schema";
import { Player } from "./Player";
import { VolleyBall } from "./VolleyBall";

/**
 * 게임 룸 상태
 */
export class GameRoomState extends Schema {
  @type("string") phase: string = "playing";
  @type([Player]) players = new ArraySchema<Player>();
  @type("number") maxPlayers: number = 4;
  @type("string") roomId: string = "";
  
  // 게임 관련 상태
  @type("number") gameStartTime: number = 0;
  @type("number") gameEndTime: number = 0;
  @type("number") leftTeamScore: number = 0;
  @type("number") rightTeamScore: number = 0;

  @type(VolleyBall) volleyBall = new VolleyBall();
}


