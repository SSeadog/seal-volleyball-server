/**
 * 게임 단계를 정의하는 enum
 */
export enum GamePhase {
  LOBBY = "lobby",           // 로비 단계
  MATCHING = "matching",     // 매칭 단계
  PLAYING = "playing",       // 게임 진행 단계
  GAME_END = "game_end"      // 게임 종료 단계
}
