import { Room } from "@colyseus/core";
import { Player } from "../rooms/schema/Player";
import { GameRoomState } from "../rooms/schema/GameRoomState";

/**
 * AI 플레이어 관리 클래스
 */
export class AIPlayerManager {
  private room: Room<GameRoomState>;
  private aiCounter: number = 0;

  constructor(room: Room<GameRoomState>) {
    this.room = room;
  }

  /**
   * AI 플레이어 생성
   */
  createAIPlayer(): Player {
    this.aiCounter++;
    const aiPlayer = new Player(
      `ai_${this.room.roomId}_${this.aiCounter}`,
      `AI_${this.aiCounter}`,
      true
    );
    return aiPlayer;
  }

  /**
   * AI 플레이어 행동 결정 (게임 로직에서 사용)
   */
  makeAIDecision(aiPlayer: Player): void {
    // TODO: AI 로직 구현
    // - 볼 위치 추적
    // - 이동 결정
    // - 액션 결정
  }
}

