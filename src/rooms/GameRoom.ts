import { Room, Client, matchMaker } from "@colyseus/core";
import { GameRoomState } from "./schema/GameRoomState";
import { Player, PlayerInputData } from "./schema/Player";
import { AIPlayerManager } from "../ai/AIPlayerManager";
import { LinkedList } from "../helpers/LinkedList";
import { GamePhase } from "../types/GamePhase";
import { GamePhysics } from "../physics/GamePhysics";
import { PhysicsConstants } from "../constants/PhysicsConstants";

/**
 * 게임 룸
 * - 매칭 완료된 4명의 플레이어가 게임을 진행
 * - 게임 종료 후 로비로 복귀
 */
export class GameRoom extends Room<GameRoomState> {
  maxClients = 4;
  aiCount = 0;
  state = new GameRoomState();
  private aiManager: AIPlayerManager;
  // 물리 및 맵 로직 전담 클래스
  private physics!: GamePhysics;
  // 플레이어 마지막 입력 상태 (sessionId -> PlayerInputData). inputQueue → 여기로 갱신 후 물리에서 사용
  private playerLastInput: Map<string, PlayerInputData> = new Map();
  private playerInputQueues: Map<string, LinkedList<PlayerInputData>> = new Map();
  // 게임 루프
  private gameLoopInterval?: NodeJS.Timeout;
  // 서버 틱 카운트
  private tickCount: number = 0;
  // 플레이어의 원래 로비 룸 ID 매핑 (sessionId -> lobbyRoomId)
  private playerLobbyRoomMap: Map<string, string> = new Map();
  
  onCreate(options: any) {
    const createdAt = Date.now();
    console.log(
      `[GameRoom] onCreate roomId=${this.roomId} at=${new Date(createdAt).toISOString()} (${createdAt}) options=`,
      options
    );

    // 상태 동기화 빈도 설정 (초당 60번)
    // this.patchRate = (1000 / 60); // 60 FPS = 1000ms / 60 = 약 16.67ms
    // this.patchRate = (1000 / 20); // 20 FPS = 1000ms / 20 = 50ms
    this.patchRate = (1000 / 15); // 15 FPS = 1000ms / 15 = 66.66ms
    
    this.state.roomId = this.roomId;
    this.state.maxPlayers = 4;
    this.state.phase = GamePhase.PLAYING;
    this.aiManager = new AIPlayerManager(this);

    // 물리 / 맵 초기화
    this.physics = new GamePhysics(this, this.playerLastInput);
    this.physics.initialize();

    let aiPlayerIndex = 0;

    console.log("options: ", options);
    console.log("options.aiCount: ", options.aiCount);

    // AI 플레이어 추가 (부족한 인원만큼)
    this.aiCount = options.aiCount || 0;
    for (let i = 0; i < this.aiCount; i++) {
      const aiPlayer = this.aiManager.createAIPlayer();
      aiPlayer.isAI = true;
      aiPlayer.playerIndex = this.maxClients - this.aiCount + aiPlayerIndex;
      aiPlayer.teamIndex = aiPlayer.playerIndex < 2 ? 0 : 1; // playerIndex 기준 팀
      this.setPlayerPosition(aiPlayer, aiPlayer.playerIndex);
      aiPlayerIndex++;
      aiPlayer.isReady = true; // ai플레이어는 자동 레디
      this.state.players.push(aiPlayer);
      console.log(`[GameRoom] Added AI player: ${aiPlayer.name} at playerIndex ${aiPlayer.playerIndex}`);
      this.broadcast("playerJoined", aiPlayer);
      console.log("playerJoined ", aiPlayer);

      // playerInput 초기화
      this.playerLastInput.set(aiPlayer.sessionId, {
        sessionId: aiPlayer.sessionId,
        left: false,
        right: false,
        jump: false,
        receive: false,
        toss: false,
        spike: false,
      });
      this.playerInputQueues.set(aiPlayer.sessionId, new LinkedList<PlayerInputData>());
    }

    
    // 메시지 핸들러 설정
    this.setupMessageHandlers();

    // // 게임 시작. 게임 시작 전 각 클라가 준비 완료됐는지 신호 받아서 모두 준비되면 시작하도록 변경 필요
    // this.state.gameStartTime = Date.now();
    // this.startGameLoop();

    const humanCount = (options.players?.length || 0);
    console.log(`[GameRoom] Created game room ${this.roomId} with ${humanCount} human players and ${this.aiCount} AI players (total: ${this.state.players.length})`);
  }

  onJoin(client: Client, options: any) {
    console.log(`[GameRoom] Client ${client.sessionId} joined game room ${this.roomId}`);
    console.log(`[GameRoom] Join options:`, options);

    const defaultName = `Player_${client.sessionId.substring(0, 6)}`;
    const nickname: string = options?.nickname ?? defaultName;
    
    // 이미 플레이어가 등록되어 있으면 업데이트, 없으면 추가
    let player = this.state.players.find(p => p.sessionId === client.sessionId);
    if (!player) {
      player = new Player(
        client.sessionId,
        nickname,
        false
      );
      player.playerIndex = options.playerIndex;
      player.teamIndex = options.teamIndex ?? (player.playerIndex < 2 ? 0 : 1); // teamIndex가 없는 경우 playerIndex 기준으로 직접 할당
      this.setPlayerPosition(player, player.playerIndex);
      this.state.players.push(player);
      
      // 클라에게 플레이어 참여했다고 신호 전송 (500ms 지연)
      setTimeout(() => {
        this.broadcast("playerJoined", player);
      }, 500);
    } else {
      // 재접속/재조인 케이스: nickname 최신화
      player.name = nickname;

      // name은 기존 동작을 최대한 유지 (기본값인 경우에만 갱신)
      if (!player.name || player.name === defaultName || player.name.startsWith("Player_")) {
        player.name = nickname;
      }
    }

    // 원래 로비 룸 ID (게임 종료 후 복귀용). 클라이언트 join 시 lobbyRoomId 전달 필요
    if (options?.lobbyRoomId) {
      this.playerLobbyRoomMap.set(client.sessionId, options.lobbyRoomId);
    }

    // playerInput 초기화
    this.playerLastInput.set(player.sessionId, {
      sessionId: player.sessionId,
      left: false,
      right: false,
      jump: false,
      receive: false,
      toss: false,
      spike: false,
    });
    if (!this.playerInputQueues.has(player.sessionId)) {
      this.playerInputQueues.set(player.sessionId, new LinkedList<PlayerInputData>());
    }
  }

  /**
   * 플레이어 인덱스에 따라 초기 스폰 좌표 설정
   */
  private setPlayerPosition(player: Player, index: number): void {
    // 플레이어 인덱스별 좌표 설정
    const positions = [
      { x: -6.19, y: 0.85 },  // 인덱스 0
      { x: -2.29, y: 0.85 },  // 인덱스 1
      { x: 2.8, y: 0.85 },    // 인덱스 2
      { x: 7, y: 0.85 }       // 인덱스 3
    ];

    if (index >= 0 && index < positions.length) {
      player.posX = positions[index].x;
      player.posY = positions[index].y;
      console.log(
        `[GameRoom] setPlayerPosition index=${index} pos=(${player.posX}, ${player.posY}) player=${player.name}`
      );
    } else {
      console.warn(`[GameRoom] setPlayerPosition invalid index=${index} player=${player.name}`);
    }

    // offset과 size 설정 (모든 플레이어 동일)
    player.offsetX = 0;
    player.offsetY = 0;
    player.sizeX = 3.67;
    player.sizeY = PhysicsConstants.PLAYER_SIZE_Y;
  }

  onLeave(client: Client, consented: boolean) {
    console.log(`[GameRoom] Client ${client.sessionId} left game room ${this.roomId}`);
    
    // 게임 중 플레이어가 나가면 처리 (AI로 대체하거나 게임 종료)
    const player = this.state.players.find(p => p.sessionId === client.sessionId);
    if (player && !player.isAI) {
      // TODO: AI로 대체하거나 게임 종료 처리
    }
    
    // 모든 플레이어(인간)가 나갔는지 확인
    const humanPlayers = this.state.players.filter(p => !p.isAI);
    const connectedHumanPlayers = this.clients.filter(c => {
      const p = this.state.players.find(pl => pl.sessionId === c.sessionId);
      return p && !p.isAI;
    });
    
    // 연결된 인간 플레이어가 없으면 룸 파괴
    if (connectedHumanPlayers.length === 0) {
      console.log(`[GameRoom] All human players left, disposing room ${this.roomId}`);
      this.disconnect();
    }

    this.playerInputQueues.delete(client.sessionId);
  }

  onDispose() {
    console.log(`[GameRoom] Room ${this.roomId} disposing...`);
    this.stopGameLoop();
    this.physics?.dispose();
  }

  /**
   * 게임 종료
   */
  endGame(): void {
    this.state.gameEndTime = Date.now();
    this.state.phase = "game_end";
    
    // AI 플레이어 제거 (로비 인원만 남김)
    const humanPlayers = this.state.players.filter(p => !p.isAI);
    this.state.players.clear();
    humanPlayers.forEach((player, index) => {
      player.playerIndex = index;
      player.isReady = false;
      this.state.players.push(player);
    });

    // 로비 룸 ID별로 플레이어 그룹화
    const playersByLobbyRoom: Map<string, Client[]> = new Map();
    
    this.clients.forEach((client) => {
      const lobbyRoomId = this.playerLobbyRoomMap.get(client.sessionId);
      if (lobbyRoomId) {
        if (!playersByLobbyRoom.has(lobbyRoomId)) {
          playersByLobbyRoom.set(lobbyRoomId, []);
        }
        const clients = playersByLobbyRoom.get(lobbyRoomId);
        if (clients) {
          clients.push(client);
        }
      }
    });


    console.log("[GameRoom] playersByLobbyRoom size: ", playersByLobbyRoom.size);
    // 각 로비 룸별로 복귀 메시지 전송
    playersByLobbyRoom.forEach(async (clients, lobbyRoomId) => {
      // lobbyRoomId로 로비 룸 생성
      await matchMaker.createRoom("lobby_room", {
        restoreLobbyRoomId: lobbyRoomId,
      });
      
      clients.forEach((client) => {
        try {
          console.log(`[GameRoom] Sending ${clients.length} players back to lobby room ${lobbyRoomId}`);
          client.send("return_to_lobby", {
            lobbyRoomId: lobbyRoomId,
            roomName: "lobby_room"
          });
        } catch (error) {
          console.error(`[GameRoom] Error sending return message to ${client.sessionId}:`, error);
        }
      });
    });

    // 게임 종료 알림 (모든 클라이언트에게)
    this.broadcast("game_ended", {
      winTeam: this.state.leftTeamScore >= 7 ? 0 : 1, // leftTeamScore가 7점 이상이면 왼쪽 팀 승리, 아니면 오른쪽 팀 승리로 처리
      message: "게임이 종료되었습니다. 로비로 돌아갑니다."
    });

    // 일정 시간 후 룸 종료 (클라이언트가 로비 룸에 재접속)
    setTimeout(() => {
      this.disconnect();
    }, 5000);
  }

  /**
   * 메시지 핸들러 설정
   */
  private setupMessageHandlers(): void {
    // pingpong
    this.onMessage("ping", (client, message) => {
      client.send("pong");
    });

    this.onMessage("ready", (client, message) => {
      console.log(`[GameRoom] receive ready message from client ${client.sessionId}`);
      const player = this.state.players.find(p => p.sessionId === client.sessionId);
      
      if (!player) {
        console.warn(`[GameRoom] Player ${client.sessionId} not found in state`);
        return;
      }

      player.isReady = true;

      if (this.checkAllPlayersReady() === true) {
        // UTC 현재 시간을 파라미터로 전달
        const utcNow = Date.now(); // UTC 타임스탬프 (밀리초)
        this.broadcast("game_start", utcNow);
        
        // 게임 시작 시간 저장
        this.state.gameStartTime = utcNow;

        // 서버 게임 루프 시작
        this.startGameLoop();
      }
    });

    // 게임 액션
    this.onMessage("game_action", (client, message) => {
      // TODO: 게임 액션 처리
      console.log(`[GameRoom] Game action from ${client.sessionId}:`, message);
    });

    this.onMessage(0, (client, message) => {
      const player = this.state.players.find(p => p.sessionId === client.sessionId);
      if (!player) return;

      const trueKeys = (["left", "right", "jump", "receive", "toss", "spike"] as const).filter(
        (k) => (message as Record<string, unknown>)[k] === true
      );
      if (trueKeys.length > 0) {
        console.log(`[GameRoom] input ${player.sessionId}: ${trueKeys.join(", ")}`);
      }

      // enqueue input to user input buffer.
      this.getOrCreateInputQueue(player.sessionId).push(message);
    });
  }

  /**
   * 서버 게임 루프 시작 (fixed timestep)
   */
  private startGameLoop(): void {
    if (this.gameLoopInterval) {
      return;
    }

    const intervalMs = 1000 / PhysicsConstants.TARGET_FPS;
    let lastTime = Date.now();
    const startTime = Date.now();
    this.gameLoopInterval = setInterval(() => {
      const now = Date.now();
      const deltaTime = (now - lastTime) / 1000; // 초 단위
      lastTime = now;

      // 실제 틱 (경과 시간 기준, DELTA_TIME은 ms)
      this.tickCount = Math.floor((now - startTime) / PhysicsConstants.DELTA_TIME);
      // 시뮬레이션은 2틱 뒤로 지연 (늦은 입력 수신 여유)
      const simulationTick = this.tickCount - 2;
      if (simulationTick >= 0 && this.state.phase === "playing") {
        this.updatePlayerInputs(simulationTick);
        this.physics.update(deltaTime, simulationTick);

        // 점수 판정: 한쪽 팀이 7점에 도달하면 게임 종료
        if (
          this.state.leftTeamScore >= 7 ||
          this.state.rightTeamScore >= 7
        ) {
          this.endGame();
        }
      }
    }, intervalMs);
  }

  /**
   * 플레이어 입력 처리 (inputQueue → playerLastInput 갱신). 물리 update 전에 호출.
   */
  private updatePlayerInputs(tickCount: number): void {
    const players = this.state.players;

    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      const lastInput = this.playerLastInput.get(player.sessionId)!;
      const inputQueue = this.getOrCreateInputQueue(player.sessionId);

      while (!inputQueue.isEmpty) {
        const input = inputQueue.peek() as PlayerInputData | undefined;
        if (!input) {
          inputQueue.shift();
          continue;
        }

        if (input.tick !== undefined) {
          // if (input.tick < tickCount - 3) { // 현재 틱보다 3틱 이전인 것만 실행. 네트워크 상황 고려 지연 실행
          if (input.tick < tickCount - 5) { // 현재 틱보다 5틱 이전인 것만 실행. 네트워크 상황 고려 지연 실행
            console.warn(
              `[GameRoom] Dropping stale input from ${player.sessionId}: inputTick=${input.tick}, serverTick=${tickCount}`
            );
            inputQueue.shift();
            continue;
          }
          if (input.tick > tickCount) {
            break;
          }
        }

        inputQueue.shift();
        lastInput.left = input.left;
        lastInput.right = input.right;
        lastInput.jump = input.jump ? input.jump : lastInput.jump;
        lastInput.receive = input.receive ? input.receive : lastInput.receive;
        lastInput.toss = input.toss ? input.toss : lastInput.toss;
        lastInput.spike = input.spike ? input.spike : lastInput.spike;
      }
    }
  }

  private getOrCreateInputQueue(sessionId: string): LinkedList<PlayerInputData> {
    let q = this.playerInputQueues.get(sessionId);
    if (!q) {
      q = new LinkedList<PlayerInputData>();
      this.playerInputQueues.set(sessionId, q);
    }
    return q;
  }
  /**
   * 서버 게임 루프 정지
   */
  private stopGameLoop(): void {
    if (this.gameLoopInterval) {
      clearInterval(this.gameLoopInterval);
      this.gameLoopInterval = undefined;
    }

    this.tickCount = 0;
  }

  /**
   * 모든 플레이어가 준비됐는지 확인
   * AI 플레이어는 제외하고 인간 플레이어만 체크
   */
  private checkAllPlayersReady(): Boolean {
    const requiredHumanReady = this.maxClients - this.aiCount;

    let readyHumanCount = 0;

    for (let i = 0; i < this.state.players.length; i++) {
      const player = this.state.players[i];

      if (player.isAI) {
        continue;
      }

      const isReady = player.isReady || false;
      console.log(`player[${i}] (${player.name}) ready is : ${isReady}`);

      if (isReady) {
        readyHumanCount++;
      }
    }

    console.log(
      `[GameRoom] checkAllPlayersReady: readyHuman=${readyHumanCount}, requiredHuman=${requiredHumanReady}`
    );

    return readyHumanCount >= requiredHumanReady;
  }
}