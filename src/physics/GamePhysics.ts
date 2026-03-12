import { Room, Client } from "@colyseus/core";
import { GameRoomState } from "../rooms/schema/GameRoomState";
import { BallPhysics, Ground, Net } from "./BallPhysics";
import { PlayerPhysics } from "./PlayerPhysics";
import { PlayerInputData } from "../rooms/schema/Player";

/**
 * 게임 물리 오케스트레이터
 * - 볼 물리와 플레이어 물리를 각각 전담 클래스에 위임
 */
export class GamePhysics {
  private grounds: Ground[] = [];
  private nets: Net[] = [];

  private ballPhysics: BallPhysics;
  private playerPhysics: PlayerPhysics;

  constructor(
    private room: Room<GameRoomState>,
    private playerLastInput: Map<string, PlayerInputData>
  ) {
    this.ballPhysics = new BallPhysics(this.room, this.grounds, this.nets);
    this.playerPhysics = new PlayerPhysics(
      this.room,
      this.nets,
      this.playerLastInput,
      this.ballPhysics
    );
  }

  /**
   * 맵 / 물리 초기화
   */
  initialize(): void {
    this.ballPhysics.initialize();
  }

  /**
   * 한 프레임 업데이트
   * @param deltaTime 초 단위 델타 타임
   * @param tickCount 서버에서 관리하는 현재 틱 카운트
   */
  update(deltaTime: number, tickCount: number): void {
    this.playerPhysics.update(deltaTime, tickCount);
    this.ballPhysics.update(deltaTime, tickCount);

    // 플레이어 위치 로그 (필요 시 사용)
    // const players = this.room.state.players;
    // for (let i = 0; i < players.length; i++) {
    //   const p = players[i];
    //   console.log(
    //     `[GamePhysics] tick ${tickCount} player[${i}] ${p.name} pos=(${p.posX.toFixed(2)}, ${p.posY.toFixed(2)})`
    //   );
    // }
  }

  /**
   * toss 처리 (메시지 수신 시 client로 player 조회 후 전달)
   */
  handleToss(client: Client, message: { handX: number; handY: number }): void {
    const player = this.room.state.players.find((p) => p.sessionId === client.sessionId);
    if (player) this.ballPhysics.handleToss(player, message);
  }

  /**
   * receive 처리 (메시지 수신 시 client로 player 조회 후 전달)
   */
  handleReceive(client: Client, message: { handX: number; handY: number }): void {
    const player = this.room.state.players.find((p) => p.sessionId === client.sessionId);
    if (player) this.ballPhysics.handleReceive(player, message);
  }

  /**
   * spike 처리 (메시지 수신 시 client로 player 조회 후 전달)
   */
  handleSpike(client: Client, message: { handX: number; handY: number }): void {
    const player = this.room.state.players.find((p) => p.sessionId === client.sessionId);
    if (player) this.ballPhysics.handleSpike(player, message);
  }

  /**
   * 리소스 정리
   */
  dispose(): void {
    this.ballPhysics.dispose();
  }
}


