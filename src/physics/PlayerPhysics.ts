import { Room } from "@colyseus/core";
import { GameRoomState } from "../rooms/schema/GameRoomState";
import { PhysicsConstants } from "../constants/PhysicsConstants";
import { PlayerInputData } from "../rooms/schema/Player";
import { Net } from "./BallPhysics";
import type { BallPhysics } from "./BallPhysics";
import { AIController } from "../ai/AIController";
import { PlayerHelper } from "../helpers/PlayerHelper";

/** 스파이크 방향/강도 (PlayerPhysics에서 관리) */
export enum SpikeDirection {
  Neutral = "neutral",
  Forward = "forward",
  Backward = "backward",
}

/**
 * 플레이어 물리 전담 클래스
 */
/** receive 한 번 켜지면 유지할 틱 수 */
const RECEIVE_HOLD_TICKS = 4;

export class PlayerPhysics {
  // 플레이어 속도 저장 (sessionId -> { velX, velY })
  private playerVelocities: Map<string, { velX: number; velY: number }> = new Map();
  private aiController: AIController = new AIController();
  /** receive 활성 유지 종료 틱 (sessionId -> tick). receive 켜지면 이 틱까지 계속 체크 */
  private receiveActiveUntilTick: Map<string, number> = new Map();

  constructor(
    private room: Room<GameRoomState>,
    private nets: Net[],
    private playerLastInput: Map<string, PlayerInputData>,
    private ballPhysics: BallPhysics
  ) {}

  update(deltaTime: number, tickCount?: number): void {
    this.updatePlayerPhysics(deltaTime, tickCount);
  }

  /**
   * 현재 입력(lastInput)에 따른 플레이어 물리 계산
   */
  private updatePlayerPhysics(deltaTime: number, tickCount?: number): void {
    const players = this.room.state.players;
    const groundTop = PhysicsConstants.PLAYER_GROUND_Y + 0.5;
    const ball = this.room.state.volleyBall;
    const net = this.nets[0];

    for (let i = 0; i < players.length; i++) {
      // playerVelocity 없다면 초기화
      if (!this.playerVelocities.has(players[i].sessionId)) {
        this.playerVelocities.set(players[i].sessionId, { velX: 0, velY: 0 });
      }

      const player = players[i];
      const velocity = this.playerVelocities.get(player.sessionId)!;
      const lastInput = this.playerLastInput.get(player.sessionId)!;

      if (player.isAI) {
        this.aiController.computeInput({
          player: {
            sessionId: player.sessionId,
            posX: player.posX,
            posY: player.posY,
            teamIndex: player.teamIndex ?? 0,
          },
          ball,
          net,
          lastInput,
          predictedLandingX:
            this.ballPhysics.getCachedPredictedLandingX() ??
            this.ballPhysics.predictBallLandingX(ball),
          lastTouchedBySessionId: this.ballPhysics.getLastTouchedBySessionId(),
          currentTick: tickCount ?? 0,
        });
      }

      // toss / receive / spike → 볼 로직 실행 후 플래그 해제 (인간/AI 공통, player 인자)
      const handMessage = PlayerHelper.getHandPosition(player, net);

      if (lastInput.toss) {
        this.ballPhysics.handleToss(player, handMessage);
        this.room.broadcast("toss", { sessionId: player.sessionId, ...handMessage });
        lastInput.toss = false;
      }
      // receive: 한 번 켜지면 RECEIVE_HOLD_TICKS 동안 유지해서 계속 receive 체크
      // - 브로드캐스트는 receive 입력이 true가 된 첫 틱에만 한 번 발생
      const tick = tickCount ?? 0;
      const receiveActiveUntil = this.receiveActiveUntilTick.get(player.sessionId);
      if (lastInput.receive) {
        const activeUntil = tick + RECEIVE_HOLD_TICKS;
        this.receiveActiveUntilTick.set(player.sessionId, activeUntil);
        const received = this.ballPhysics.handleReceive(player, handMessage);
        this.room.broadcast("receive", {
          sessionId: player.sessionId,
          ...handMessage,
        });
        if (received) {
          this.receiveActiveUntilTick.delete(player.sessionId);
        }
        lastInput.receive = false;
      } else if (receiveActiveUntil !== undefined && tick < receiveActiveUntil) {
        const received = this.ballPhysics.handleReceive(player, handMessage);
        if (received) {
          this.receiveActiveUntilTick.delete(player.sessionId);
        }
      }
      if (receiveActiveUntil !== undefined && tick >= receiveActiveUntil) {
        this.receiveActiveUntilTick.delete(player.sessionId);
      }
      if (lastInput.spike) {
        // 앞쪽(네트 방향) 입력이면 강하게, 뒤쪽이면 약하게 스파이크
        const isLeftTeam = net ? PlayerHelper.isOnLeft(player, net) : player.teamIndex === 0;
        const forward = isLeftTeam ? lastInput.right : lastInput.left;
        const backward = isLeftTeam ? lastInput.left : lastInput.right;
        let spikeDirection = SpikeDirection.Neutral;
        if (forward) {
          spikeDirection = SpikeDirection.Forward;
        } else if (backward) {
          spikeDirection = SpikeDirection.Backward;
        }
        this.ballPhysics.handleSpike(player, handMessage, spikeDirection);
        this.room.broadcast("spike", { sessionId: player.sessionId, ...handMessage });
        lastInput.spike = false;
      }

      // 마지막 입력 상태 기반 이동
      if (lastInput.left) {
        velocity.velX = -PhysicsConstants.PLAYER_MOVE_SPEED;
      } else if (lastInput.right) {
        velocity.velX = PhysicsConstants.PLAYER_MOVE_SPEED;
      } else {
        velocity.velX *= PhysicsConstants.PLAYER_VELOCITY_DECAY;
        if (Math.abs(velocity.velX) < PhysicsConstants.VELOCITY_THRESHOLD) {
          velocity.velX = 0;
        }
      }

      // 점프 (땅에 있을 때만)
      if (lastInput.jump) {
        const playerHalfHeight = player.sizeY / 2;
        const playerBottom = player.posY - playerHalfHeight;
        const isOnGround = Math.abs(playerBottom - groundTop) < 0.1;
        if (isOnGround && velocity.velY <= 0) {
          velocity.velY = PhysicsConstants.PLAYER_JUMP_VELOCITY;
          // console.log(`[GamePhysics] Player ${player.sessionId} jumped`);

          this.room.broadcast("jump", { sessionId: player.sessionId });
        }

        lastInput.jump = false;
      }

      // 중력 적용
      velocity.velY += PhysicsConstants.GRAVITY * deltaTime;

      // 위치 업데이트
      player.posX += velocity.velX * deltaTime;
      player.posY += velocity.velY * deltaTime;

      // 땅 충돌
      const playerHalfHeight = player.sizeY / 2;
      const playerBottom = player.posY - playerHalfHeight;
      if (playerBottom <= groundTop) {
        player.posY = groundTop + playerHalfHeight;
        velocity.velY = 0;
      }

      // 네트 충돌: 네트 X 기준선을 넘지 않도록 팀별로 제한
      for (const net of this.nets) {
        const netX = net.x;
        const playerHalfWidth = player.sizeX / 2;
        const isLeftTeam = PlayerHelper.isOnLeft(player, net);

        if (isLeftTeam && player.posX + playerHalfWidth > netX) {
          player.posX = netX - playerHalfWidth;
          velocity.velX = 0;
        } else if (!isLeftTeam && player.posX - playerHalfWidth < netX) {
          player.posX = netX + playerHalfWidth;
          velocity.velX = 0;
        }
      }
    }

    // // 디버그용 로그 로직
    // const player0 = this.room.state.players.find((p) => p.playerIndex === 0);
    // if (player0) {
    //   console.log(
    //     `[PlayerPhysics] playerIndex=0 pos=(${player0.posX.toFixed(3)}, ${player0.posY.toFixed(3)})`
    //   );
    // }
  }
}

