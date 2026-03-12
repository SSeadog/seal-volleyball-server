import { Client, Room, matchMaker } from "@colyseus/core";

/**
 * 매칭 큐에 등록된 플레이어 정보
 */
interface QueuedPlayer {
  sessionId: string;
  client: Client;
  roomId: string; // 현재 있는 로비 룸 ID
  playerName?: string;
  queuedAt: number;
}

/**
 * 전역 매칭 매니저 (싱글톤)
 * 여러 로비 룸의 플레이어들을 모아서 게임 룸으로 매칭
 */
export class Matchmaker {
  private static instance: Matchmaker;
  private matchQueue: QueuedPlayer[] = [];
  private readonly REQUIRED_PLAYERS = 4;
  private matchCheckInterval?: NodeJS.Timeout;
  private gameServer?: any; // GameServer 타입 (Colyseus tools에서 제공)

  /**
   * 싱글톤 인스턴스 가져오기
   */
  static getInstance(): Matchmaker {
    if (!Matchmaker.instance) {
      Matchmaker.instance = new Matchmaker();
    }
    return Matchmaker.instance;
  }

  /**
   * GameServer 인스턴스 설정 (app.config.ts에서 호출)
   */
  setGameServer(gameServer: any): void {
    this.gameServer = gameServer;
    this.startMatchCheck();
  }

  /**
   * 매칭 큐에 플레이어 추가
   */
  enqueuePlayer(client: Client, roomId: string, playerName?: string): void {
    // 이미 큐에 있는지 확인
    const existingIndex = this.matchQueue.findIndex(p => p.sessionId === client.sessionId);
    if (existingIndex !== -1) {
      console.log(`[Matchmaker] Player ${client.sessionId} already in queue`);
      return;
    }

    const player: QueuedPlayer = {
      sessionId: client.sessionId,
      client,
      roomId,
      playerName,
      queuedAt: Date.now()
    };

    this.matchQueue.push(player);
    console.log(`[Matchmaker] Player ${client.sessionId} enqueued. Queue size: ${this.matchQueue.length}`);

    // 즉시 매칭 체크
    this.checkMatch();
  }

  /**
   * 매칭 큐에서 플레이어 제거
   */
  dequeuePlayer(sessionId: string): void {
    const index = this.matchQueue.findIndex(p => p.sessionId === sessionId);
    if (index !== -1) {
      this.matchQueue.splice(index, 1);
      console.log(`[Matchmaker] Player ${sessionId} dequeued. Queue size: ${this.matchQueue.length}`);
    }
  }

  /**
   * 주기적으로 매칭 체크
   */
  private startMatchCheck(): void {
    // 1초마다 매칭 체크
    this.matchCheckInterval = setInterval(() => {
      this.checkMatch();
    }, 1000);
  }

  /**
   * 매칭 가능한 플레이어 그룹 찾기 및 게임 룸 생성
   */
  private checkMatch(): void {
    // 큐가 비어있으면 종료
    if (this.matchQueue.length === 0) {
      return;
    }

    // 맨 앞 플레이어 매칭 대기 시간이 5초 이상이면 ai로 채워서 매칭 종료시키기
    const firstPlayer = this.matchQueue[0];
    const waitTime = Date.now() - firstPlayer.queuedAt;
    const MAX_WAIT_TIME = 5000; // 5초

    if (waitTime >= MAX_WAIT_TIME && this.matchQueue.length < this.REQUIRED_PLAYERS) {
      // 5초 이상 대기했고 4명이 안 모였으면, 부족한 인원만큼 AI로 채우기
      const neededAI = this.REQUIRED_PLAYERS - this.matchQueue.length;
      const players = this.matchQueue.splice(0, this.matchQueue.length); // 큐의 모든 플레이어 가져오기
      
      console.log(`[Matchmaker] First player waited ${waitTime}ms. Filling ${neededAI} slots with AI players.`);
      this.createGameRoom(players, neededAI);
      return;
    }

    // 정상적으로 4명이 모였으면 매칭
    if (this.matchQueue.length >= this.REQUIRED_PLAYERS) {
      // 큐에서 4명씩 그룹으로 묶기
      while (this.matchQueue.length >= this.REQUIRED_PLAYERS) {
        const players = this.matchQueue.splice(0, this.REQUIRED_PLAYERS);
        this.createGameRoom(players, 0);
      }
    }
  }

  /**
   * 게임 룸 생성 및 플레이어 이동
   * @param players 실제 플레이어 목록
   * @param aiCount AI 플레이어 개수 (부족한 인원만큼)
   */
  private async createGameRoom(players: QueuedPlayer[], aiCount: number): Promise<void> {
    if (!this.gameServer) {
      console.error("[Matchmaker] GameServer not initialized");
      return;
    }

    try {
      // 게임 룸 생성 옵션 준비
      const roomOptions: any = {
        // players: players.map(p => ({
        //   sessionId: p.sessionId,
        //   playerName: p.playerName,
        //   roomId: p.roomId
        // })),
        aiCount: aiCount // AI 플레이어 개수 전달
      };

      // 게임 룸 생성
      const gameRoom = await matchMaker.createRoom("game_room", roomOptions);

      const totalPlayers = players.length + aiCount;
      console.log(`[Matchmaker] Created game room ${gameRoom.roomId} with ${players.length} human players and ${aiCount} AI players (total: ${totalPlayers})`);

      // 각 플레이어를 게임 룸으로 이동 (큐 순서 1,2번 → teamIndex 0, 3,4번 → teamIndex 1)
      for (let i = 0; i < players.length; i++) {
        try {
          const teamIndex = i < 2 ? 0 : 1;
          players[i].client.send("match_end", {
            playerIndex: i,
            teamIndex,
            roomId: gameRoom.roomId,
            roomName: "game_room"
          });

          console.log(`[Matchmaker] Send match_end to player ${players[i].sessionId}`);

          // 원래 로비 룸에서 나가기 (클라이언트가 처리)
          // 또는 여기서 leave 처리
        } catch (error) {
          console.error(`[Matchmaker] Error moving player ${players[i].sessionId}:`, error);
        }
      }
    } catch (error) {
      console.error("[Matchmaker] Error creating game room:", error);
      // 실패 시 플레이어들을 다시 큐에 추가
      this.matchQueue.unshift(...players);
    }
  }

  /**
   * 큐 상태 확인 (디버깅용)
   */
  getQueueStatus(): { queueSize: number; players: string[] } {
    return {
      queueSize: this.matchQueue.length,
      players: this.matchQueue.map(p => p.sessionId)
    };
  }

  /**
   * 정리
   */
  dispose(): void {
    if (this.matchCheckInterval) {
      clearInterval(this.matchCheckInterval);
    }
    this.matchQueue = [];
  }
}
