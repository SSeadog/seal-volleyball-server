import { Room, Client } from "@colyseus/core";
import { LobbyRoomState } from "./schema/LobbyRoomState";
import { Player } from "./schema/Player";
import { Matchmaker } from "../matching/Matchmaker";
import { GamePhase } from "../types/GamePhase";

/**
 * 로비 룸
 * - 최대 4명 참가 가능
 * - 초대 기능
 * - 매칭 시작 시 전역 매칭 큐에 등록
 */
export class LobbyRoom extends Room<LobbyRoomState> {
  maxClients = 4;
  state = new LobbyRoomState();
  private matchmaker = Matchmaker.getInstance();

  onCreate(options: any) {
    this.state.roomId = this.roomId;
    this.state.maxPlayers = 4;
    this.state.phase = GamePhase.LOBBY;

    // 메시지 핸들러 설정
    this.setupMessageHandlers();
  }

  onJoin(client: Client, options: any) {
    console.log(`[LobbyRoom] Client ${client.sessionId} joined room ${this.roomId}`);
    
    // 방장 설정
    if (this.state.players.length === 0)
      this.state.roomOwnerSessionId = client.sessionId;

    const player = new Player(
      client.sessionId,
      options.playerName || `Player_${client.sessionId.substring(0, 6)}`,
      false
    );
    player.playerIndex = this.state.players.length;
    this.state.players.push(player);

    console.log(`[LobbyRoom] Room ${this.roomId} now has ${this.state.players.length} players`);

    // 클라에게 플레이어 참여했다고 신호 전송
    this.broadcast("playerJoined", player);
  }

  onLeave(client: Client, consented: boolean) {
    console.log(`[LobbyRoom] Client ${client.sessionId} left room ${this.roomId}`);
    
    // 플레이어 제거
    const index = this.state.players.findIndex(p => p.sessionId === client.sessionId);
    if (index !== -1) {
      const player = this.state.players[index];
      
      // 매칭 큐에서도 제거
      if (player.isInMatchQueue) {
        this.matchmaker.dequeuePlayer(client.sessionId);
      }
      
      // 클라에게 플레이어 나갔다고 신호 전송
      this.broadcast("playerLeft", player);

      this.state.players.splice(index, 1);
      
      // 위치 재정렬
      this.state.players.forEach((p, i) => p.playerIndex = i);
    }

    console.log(`[LobbyRoom] Room ${this.roomId} now has ${this.state.players.length} players`);
  }

  onDispose() {
    console.log(`[LobbyRoom] Room ${this.roomId} disposing...`);
    
    // 모든 플레이어를 매칭 큐에서 제거
    this.state.players.forEach(player => {
      if (player.isInMatchQueue) {
        this.matchmaker.dequeuePlayer(player.sessionId);
      }
    });
  }

  /**
   * 메시지 핸들러 설정
   */
  private setupMessageHandlers(): void {
    // 매칭 시작 요청
    // 같은 로비 룸 플레이어들은 모두 매칭 큐에 등록
    this.onMessage("start_matching", (client) => {
      const requestingPlayer = this.state.players.find(p => p.sessionId === client.sessionId);
      if (!requestingPlayer) {
        console.warn(`[LobbyRoom] Player ${client.sessionId} not found`);
        return;
      }

      // 이미 큐에 있는 플레이어가 있으면 리턴
      if (requestingPlayer.isInMatchQueue) {
        console.log(`[LobbyRoom] Player ${client.sessionId} already in match queue`);
        client.send("match_status", { inQueue: true });
        return;
      }

      // 로비에 있는 모든 플레이어를 매칭 큐에 등록
      let enqueuedCount = 0;
      this.state.players.forEach((player) => {
        // 이미 큐에 있으면 스킵
        if (player.isInMatchQueue) {
          return;
        }

        // 해당 플레이어의 클라이언트 찾기
        const playerClient = this.clients.find(c => c.sessionId === player.sessionId);
        if (!playerClient) {
          console.warn(`[LobbyRoom] Client not found for player ${player.sessionId}`);
          return;
        }

        // 매칭 큐에 등록
        player.isInMatchQueue = true;
        this.matchmaker.enqueuePlayer(playerClient, this.roomId, player.name);
        enqueuedCount++;
        
        console.log(`[LobbyRoom] Player ${player.sessionId} (${player.name}) enqueued for matching`);
      });

      // 모든 플레이어에게 매칭 상태 전송
      const queueStatus = this.matchmaker.getQueueStatus();
      this.clients.forEach((c) => {
        c.send("match_status", { 
          inQueue: true, 
          queueSize: queueStatus.queueSize 
        });
      });

      console.log(`[LobbyRoom] ${enqueuedCount} players from room ${this.roomId} started matching`);
    });

    // 매칭 취소
    this.onMessage("cancel_matching", (client) => {
      const player = this.state.players.find(p => p.sessionId === client.sessionId);
      if (!player || !player.isInMatchQueue) {
        return;
      }

      player.isInMatchQueue = false;
      this.matchmaker.dequeuePlayer(client.sessionId);
      
      console.log(`[LobbyRoom] Player ${client.sessionId} cancelled matching`);
      client.send("match_status", { inQueue: false });
    });
  }
}


