import { Room } from "@colyseus/core";
import { GameRoomState } from "../rooms/schema/GameRoomState";
import { PhysicsConstants } from "../constants/PhysicsConstants";

/**
 * 지형 정보 (땅)
 */
export interface Ground {
  x: number;      // X 좌표
  y: number;      // Y 좌표 (땅의 중심 Y)
  width: number;  // 가로 길이
  height: number; // 높이
}

/**
 * 네트 정보
 */
export interface Net {
  x: number;      // X 좌표 (중심)
  y: number;      // Y 좌표 (중심)
  width: number;  // 너비 (두께)
  height: number; // 높이
}

/** 스파이크 방향/강도 */
export enum SpikeDirection {
  Neutral = "neutral",
  Forward = "forward",
  Backward = "backward",
}

/**
 * 볼 물리 및 맵/지형 처리 전담 클래스
 */
export class BallPhysics {
  private ballInitialPosX: number = -5.64;
  private ballInitialPosY: number = 6.5;
  private ballInitialVelX: number = 0;
  private ballInitialVelY: number = 0;

  // 볼이 땅에 닿았는지 추적 (중복 메시지 방지)
  private ballHitGround: boolean = false;
  private ballResetTimeout?: NodeJS.Timeout;
  // 볼이 리셋 후 공중에 머무는 시간 추적
  private ballResetHoverTime: number = 0; // 0이면 정상, 0보다 크면 공중에 머무는 중
  // 땅에 최초로 닿은 틱 (null이면 아직 안 닿음). tick 기준 유예 시간 계산용
  private groundTouchedTick: number | null = null;
  /** 예상 착지 X (매 틱 update() 끝에서 계산·캐시, AI 등에서 사용) */
  private cachedPredictedLandingX: number | null = null;
  /** 마지막으로 공을 터치한 플레이어의 sessionId (AI가 본인 터치 시 가만히 있도록 사용) */
  private lastTouchedBySessionId: string = "";
  /** 마지막 득점을 한 팀 (0=left, 1=right) */
  private lastScoringTeam: 0 | 1 = 0;

  /** 코트 X 경계 (네트 0 기준, 절반 코트 폭). 이 안이면 코트 안, 밖이면 코트 밖 */
  private static readonly COURT_HALF_WIDTH = 15;

  constructor(
    private room: Room<GameRoomState>,
    private grounds: Ground[],
    private nets: Net[]
  ) {}

  initialize(): void {
    // 맵 초기화: (0, -0.5) 좌표에 높이 1, 가로 100짜리 땅 추가
    this.grounds.push({
      x: 0,
      y: -0.5,
      width: 100,
      height: 1
    });
    console.log(`[GamePhysics] Map initialized with ground at (0, 0), size: 100x2`);

    // 네트 초기화: (0, 0) 좌표에 높이 2.42, 너비 0.1짜리 네트 추가
    this.nets.push({
      x: 0,
      y: 1.21,
      width: 0.2,
      height: 2.42
    });
    console.log(`[GamePhysics] Net initialized at (0, 0), size: 0.1x2.42`);

    // 볼 초기 상태 저장 (Schema 기본 값 기준)
    const ball = this.room.state.volleyBall;
    this.ballInitialPosX = ball.posX;
    this.ballInitialPosY = ball.posY;
    this.ballInitialVelX = ball.velX;
    this.ballInitialVelY = ball.velY;
  }

  /**
   * 득점 팀(0=left, 1=right)에 따라 점수 증가 + 공 초기화 + judge 브로드캐스트
   */
  private applyScoreAndReset(scoringTeam: 0 | 1): void {
    const state = this.room.state;
    if (scoringTeam === 0) {
      state.leftTeamScore++;
    } else {
      state.rightTeamScore++;
    }
     this.lastScoringTeam = scoringTeam;
    console.log(
      `[BallPhysics] 점수 판정: ${scoringTeam === 0 ? "left" : "right"} 팀 득점 → left ${state.leftTeamScore} : ${state.rightTeamScore} right`
    );
    if (this.ballResetTimeout) {
      clearTimeout(this.ballResetTimeout);
      this.ballResetTimeout = undefined;
    }
    
    setTimeout(() => {
      this.resetBall();
    }, 3000);
      
    this.room.broadcast("judge", scoringTeam);
  }

  /**
   * 볼의 물리 시뮬레이션 (중력 적용)
   * @param deltaTime 초 단위 델타 타임
   * @param tickCount 서버 틱 (GROUND_GRACE_TICKS 계산용)
   */
  update(deltaTime: number, tickCount: number): void {
    const ball = this.room.state.volleyBall;

    // 3번 초과 터치(4번째 터치) 시 마지막 터치 팀 실점 → 상대 득점
    const touchCount = ball.touchCount ?? 0;
    if (touchCount == 4) {
      const lastTouchTeam = ball.owningTeam ?? -1;
      const scoringTeam: 0 | 1 = lastTouchTeam === 0 ? 1 : 0;
      this.applyScoreAndReset(scoringTeam);
      return;
    }

    // 땅에 닿은 뒤 2틱 동안은 유예, 그 이후에는 강제로 땅 판정 실행
    if (
      this.groundTouchedTick !== null &&
      !this.ballHitGround &&
      tickCount - this.groundTouchedTick >= 2
    ) {
      this.ballHitGround = true;

      const netX = this.nets[0]?.x ?? 0;
      const inCourtLeft =
        -BallPhysics.COURT_HALF_WIDTH <= ball.posX && ball.posX < netX;
      const inCourtRight =
        netX <= ball.posX && ball.posX <= BallPhysics.COURT_HALF_WIDTH;
      const inCourt = inCourtLeft || inCourtRight;

      let scoringTeam: 0 | 1;
      if (inCourt) {
        // 코트 안 땅: 떨어진 위치 코트 팀 실점 → 상대 득점
        scoringTeam = ball.posX < netX ? 1 : 0;
      } else {
        // 코트 밖 땅: 마지막 터치 팀 실점 → 상대 득점
        const lastTouchTeam = ball.owningTeam ?? -1;
        scoringTeam = lastTouchTeam === 0 ? 1 : 0;
      }

      const state = this.room.state;
      if (scoringTeam === 0) state.leftTeamScore++;
      else state.rightTeamScore++;
      this.lastScoringTeam = scoringTeam;
      console.log(
        `[BallPhysics] 점수 판정(땅): ${scoringTeam === 0 ? "left" : "right"} 팀 득점 → left ${state.leftTeamScore} : ${state.rightTeamScore} right`
      );
      this.room.broadcast("judge", scoringTeam);

      this.ballResetTimeout = setTimeout(() => {
        this.resetBall();
      }, 3000);
    }

    // 리셋 후 공중에 머무는 시간이 남아있으면 물리 시뮬레이션 건너뛰기
    if (this.ballResetHoverTime > 0) {
      this.ballResetHoverTime -= deltaTime;
      if (this.ballResetHoverTime <= 0) {
        // 공중에 머무는 시간이 끝나면 초기 위치로 이동
        ball.posX = this.lastScoringTeam === 0
        ? this.ballInitialPosX
        : -this.ballInitialPosX;
        ball.posY = this.ballInitialPosY;
        ball.velX = this.ballInitialVelX;
        ball.velY = this.ballInitialVelY;
        // console.log(`[GamePhysics] Ball hover time ended, moved to initial position`);
      }
      this.cachedPredictedLandingX = null;
      return; // 공중에 머무는 동안은 물리 시뮬레이션 하지 않음
    }

    // 중력 적용 (Y축 속도에 중력 가속도 추가)
    ball.velY += PhysicsConstants.GRAVITY * deltaTime;

    const prevPosX = ball.posX;
    // 위치 업데이트 (속도 * 시간)
    ball.posX += ball.velX * deltaTime;
    ball.posY += ball.velY * deltaTime;

    // 공이 네트를 넘어가면 터치 카운트 초기화
    const netX = this.nets[0]?.x ?? 0;
    if ((prevPosX - netX) * (ball.posX - netX) < 0) {
      ball.touchCount = 0;
    }

    // 네트와의 충돌 체크 (땅보다 먼저 체크)
    if (!this.checkNetCollision(ball)) {
      // 네트 충돌이 없으면 땅 충돌 체크
      this.checkGroundCollision(ball, tickCount);
    }

    // 예상 착지 X 계산·캐시 (AI 등에서 사용)
    this.cachedPredictedLandingX = this.predictBallLandingX(ball);
  }

  /** 현재 캐시된 예상 착지 X (매 틱 update() 끝에서 갱신됨) */
  getCachedPredictedLandingX(): number | null {
    return this.cachedPredictedLandingX;
  }

  /** 마지막으로 공을 터치한 플레이어의 sessionId */
  getLastTouchedBySessionId(): string {
    return this.lastTouchedBySessionId;
  }

  /**
   * 공의 예상 착지 X (중력만 적용, 땅 위 착지 Y 기준)
   */
  predictBallLandingX(
    ball: { posX: number; posY: number; velX: number; velY: number }
  ): number | null {
    const landY =
      PhysicsConstants.PLAYER_GROUND_Y + 0.5 + PhysicsConstants.BALL_RADIUS;
    const g = PhysicsConstants.GRAVITY;
    const dy = ball.posY - landY;
    const disc = ball.velY * ball.velY - 2 * g * dy;
    if (disc < 0) return null;
    const t = (ball.velY + Math.sqrt(disc)) / (-g);
    if (t <= 0) return null;
    return ball.posX + ball.velX * t;
  }

  /**
   * 네트와의 충돌 체크
   * @returns 충돌했으면 true, 아니면 false
   */
  private checkNetCollision(ball: { posX: number; posY: number; velX: number; velY: number }): boolean {
    for (const net of this.nets) {
      // 볼의 범위
      const ballBottom = ball.posY - PhysicsConstants.BALL_RADIUS;
      const ballTop = ball.posY + PhysicsConstants.BALL_RADIUS;
      const ballLeft = ball.posX - PhysicsConstants.BALL_RADIUS;
      const ballRight = ball.posX + PhysicsConstants.BALL_RADIUS;

      // 네트의 범위 (중심 기준)
      const netTop = net.y + net.height / 2;
      const netBottom = net.y - net.height / 2;
      const netLeft = net.x - net.width / 2;
      const netRight = net.x + net.width / 2;

      // 충돌 체크: 볼이 네트의 범위 내에 있으면
      if (
        ballBottom <= netTop &&
        ballTop >= netBottom &&
        ballRight >= netLeft &&
        ballLeft <= netRight
      ) {
        // 네트 상단 충돌 체크 (볼이 네트 상단 부분에 닿았는지)
        const isTopCollision = ballBottom <= netTop && ballBottom >= netTop - 0.3; // 상단 0.3 범위 내
        
        if (isTopCollision) {
          // 네트 상단에 닿았을 때: Y축 속도 반전, X축 속도는 조금 감소
          ball.posY = netTop + PhysicsConstants.BALL_RADIUS;
          
          // Y축 속도 반전 (탄성 계수 절반 적용)
          const netBounceFactor = PhysicsConstants.BOUNCE_FACTOR * 0.5;
          ball.velY = Math.abs(ball.velY) * netBounceFactor;
          
          // X축 속도는 조금 감소
          ball.velX *= 0.8;
          
          // console.log(
          //   `[GamePhysics] Ball hit the top of the net at (${ball.posX.toFixed(2)}, ${ball.posY.toFixed(2)})`
          // );
        } else {
          // 네트 측면에 닿았을 때: 기존 로직 (X축 반전)
          // 볼이 네트의 왼쪽에 있는지 오른쪽에 있는지 확인하여 위치 조정
          if (ball.posX < net.x) {
            // 볼이 네트 왼쪽에 있으면 네트 왼쪽에 위치
            ball.posX = netLeft - PhysicsConstants.BALL_RADIUS;
          } else {
            // 볼이 네트 오른쪽에 있으면 네트 오른쪽에 위치
            ball.posX = netRight + PhysicsConstants.BALL_RADIUS;
          }

          // X축 속도 반전 (탄성 계수 절반 적용: 0.7 * 0.5 = 0.35)
          const netBounceFactor = PhysicsConstants.BOUNCE_FACTOR * 0.5;
          ball.velX = -ball.velX * netBounceFactor;

          // Y축 속도는 약간 감소 (네트가 약간의 마찰 효과)
          ball.velY *= 0.9;
          
          // console.log(
          //   `[GamePhysics] Ball hit the side of the net at (${ball.posX.toFixed(2)}, ${ball.posY.toFixed(2)})`
          // );
        }

        // 속도가 매우 작으면 정지
        if (Math.abs(ball.velX) < PhysicsConstants.VELOCITY_THRESHOLD) {
          ball.velX = 0;
        }
        if (Math.abs(ball.velY) < PhysicsConstants.VELOCITY_THRESHOLD) {
          ball.velY = 0;
        }

        this.cachedPredictedLandingX = this.predictBallLandingX(ball);
        return true; // 충돌 발생
      }
    }
    return false; // 충돌 없음
  }

  /**
   * 지형과의 충돌 체크
   * @param currentTick 서버 틱 (GROUND_GRACE_TICKS 계산용)
   */
  private checkGroundCollision(
    ball: { posX: number; posY: number; velX: number; velY: number; owningTeam?: number },
    currentTick: number
  ): void {
    for (const ground of this.grounds) {
      // 볼이 땅의 범위 내에 있는지 확인
      const ballBottom = ball.posY - PhysicsConstants.BALL_RADIUS;
      const ballTop = ball.posY + PhysicsConstants.BALL_RADIUS;
      const ballLeft = ball.posX - PhysicsConstants.BALL_RADIUS;
      const ballRight = ball.posX + PhysicsConstants.BALL_RADIUS;

      // 땅의 범위 (중심 기준)
      const groundTop = ground.y + ground.height / 2;
      const groundBottom = ground.y - ground.height / 2;
      const groundLeft = ground.x - ground.width / 2;
      const groundRight = ground.x + ground.width / 2;

      // 충돌 체크: 볼의 하단이 땅의 상단보다 아래에 있고, X 범위 내에 있으면
      if (
        ballBottom <= groundTop &&
        ballTop >= groundBottom &&
        ballRight >= groundLeft &&
        ballLeft <= groundRight
      ) {
        // 첫 번째 충돌 시점에는 groundTouchedTick만 기록 (실점 판정은 update에서 처리)
        if (this.groundTouchedTick === null) {
          this.groundTouchedTick = currentTick;
        }

        // 땅 위에 위치시키기 + 튕김(실점 판정 전에도 물리 계속 적용)
        ball.posY = groundTop + PhysicsConstants.BALL_RADIUS;
        ball.velY = Math.abs(ball.velY) * PhysicsConstants.BOUNCE_FACTOR;
        ball.velX *= PhysicsConstants.FRICTION;
        if (Math.abs(ball.velY) < PhysicsConstants.VELOCITY_THRESHOLD) ball.velY = 0;
        if (Math.abs(ball.velX) < PhysicsConstants.VELOCITY_THRESHOLD) ball.velX = 0;
        break;
      }
    }
  }

  /**
   * 볼 위치 및 속도 초기화
   * 공을 초기 위치에서 1초 동안 공중에 머물게 함
   */
  private resetBall(): void {
    const ball = this.room.state.volleyBall;

    // 공을 초기 위치로 이동 (공중에 머물도록)
    ball.posX =
      this.lastScoringTeam === 0
        ? this.ballInitialPosX
        : -this.ballInitialPosX;
    ball.posY = this.ballInitialPosY; // 초기 위치에서 머물기
    ball.velX = 0;
    ball.velY = 0; // 속도 0으로 설정 (공중에 정지)
    ball.owningTeam = -1;
    ball.touchCount = 0;
    this.cachedPredictedLandingX = this.predictBallLandingX(ball);
    this.lastTouchedBySessionId = "";
    this.ballHitGround = false;
    this.groundTouchedTick = null;

    // 1초 동안 공중에 머물도록 설정
    this.ballResetHoverTime = 1.0; // 1초

    this.ballHitGround = false;
    this.room.broadcast("resetBall");

    // console.log(
    //   `[GamePhysics] Ball reset to initial position (${ball.posX}, ${ball.posY}), will drop in 1 second`
    // );
  }

  /** handleToss/Receive/Spike에 넘길 플레이어 정보 (로그용) */
  private playerLabel(player: { sessionId: string; name?: string }): string {
    return player.name ? `${player.name}(${player.sessionId})` : player.sessionId;
  }

  /**
   * 공이 위로 완만한 포물선을 그려 (targetX, targetY)에 도달하도록 하는 초기 속도 계산 (중력 적용).
   * 초기 Y속도는 TOSS_VELOCITY를 사용하고, 목표는 최고점을 지난 뒤 내려오는 구간에서 지나가도록 한다.
   */
  private velocityToReachPoint(
    posX: number,
    posY: number,
    targetX: number,
    targetY: number
  ): { velX: number; velY: number } {
    const g = PhysicsConstants.GRAVITY;
    const gAbs = Math.abs(g);
    const tossVel = PhysicsConstants.TOSS_VELOCITY;

    // 완만한 포물선을 위해 초기 상승 속도를 TOSS_VELOCITY로 고정 (필요 시 목표 높이에 맞춰 최소값 사용)
    const dy = targetY - posY;
    const minVelY = dy > 0 ? Math.sqrt(2 * gAbs * dy) : 0;
    const velY = Math.max(tossVel, minVelY);

    // y(t) = posY + velY*t + 0.5*g*t^2 = targetY 의 큰 근 = 내려오는 시점 t
    const disc = velY * velY - 2 * g * (posY - targetY);
    if (disc < 0) {
      const t = 0.5;
      return {
        velX: (targetX - posX) / t,
        velY: (targetY - posY - 0.5 * g * t * t) / t,
      };
    }
    const t = (-velY - Math.sqrt(disc)) / g;

    const velX = t > 0.01 ? (targetX - posX) / t : 0;
    return { velX, velY };
  }

  /** 터치 성공 시 소유권·터치 카운트 갱신 (player.teamIndex 기준: 0=왼쪽, 1=오른쪽) */
  private applyTouchOwnership(teamIndex: number): void {
    const ball = this.room.state.volleyBall;
    const owning = ball.owningTeam ?? -1;

    if (owning < 0) {
      ball.owningTeam = teamIndex;
      ball.touchCount = 1;
    } else if (ball.owningTeam === teamIndex) {
      ball.touchCount = (ball.touchCount ?? 0) + 1;
    } else {
      ball.owningTeam = teamIndex;
      ball.touchCount = 1;
    }
  }

  /**
   * toss 처리 (인간/AI 공통, player 기준 로그)
   */
  handleToss(
    player: { sessionId: string; name?: string; teamIndex?: number },
    message: { handX: number; handY: number }
  ): void {
    const { handX, handY } = message;
    const label = this.playerLabel(player);

    if (handX === undefined || handY === undefined) {
      console.warn(
        `[GamePhysics] Invalid toss message from ${label}: missing handX or handY`
      );
      return;
    }

    // console.log(`[GamePhysics] Ball tossed by ${label} at handX: ${handX} handY: ${handY})`);

    const ball = this.room.state.volleyBall;

    // 공 위치와 손 위치 사이의 거리 계산
    const distanceX = Math.abs(ball.posX - handX);
    const distanceY = Math.abs(ball.posY - handY);
    const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);

    // PLAYER_HAND_CHECK_RADIUS 범위 내에 있으면 공을 위로 띄우기
    if (distance <= PhysicsConstants.PLAYER_HAND_CHECK_RADIUS) {
      const net = this.nets[0];
      const netTop = net ? net.y + net.height / 2 : 2.42;
      const tossTargetY = netTop + 1; // 네트 약간 위
      const tossTargetOffsetX = 0.5; // 네트 중심에서 좌/우로 떨어진 거리

      const targetX =
        (player.teamIndex === 1 && net)
          ? net.x + tossTargetOffsetX
          : (net?.x ?? 0) - tossTargetOffsetX;

      const { velX, velY } = this.velocityToReachPoint(
        ball.posX,
        ball.posY,
        targetX,
        tossTargetY
      );
      ball.velX = velX;
      ball.velY = velY;

      this.applyTouchOwnership(player.teamIndex);
      this.lastTouchedBySessionId = player.sessionId;
      this.cachedPredictedLandingX = this.predictBallLandingX(ball);

      // 땅 유예 상태였다면, 유효한 토스로 랠리를 이어갔으므로 groundTouchedTick 초기화
      this.groundTouchedTick = null;

      // console.log(
      //   `[GamePhysics] Ball tossed by ${label} at distance ${distance.toFixed(2)} toward (${targetX.toFixed(2)}, ${tossTargetY.toFixed(2)})`
      // );
    } else {
      // console.log(
      //   `[GamePhysics] Toss failed: distance ${distance.toFixed(2)} > ${PhysicsConstants.PLAYER_HAND_CHECK_RADIUS} from ${label}`
      // );
    }
  }

  /**
   * receive 처리 (인간/AI 공통, player 기준 로그)
   */
  handleReceive(
    player: { sessionId: string; name?: string; teamIndex?: number },
    message: { handX: number; handY: number }
  ): boolean {
    const { handX, handY } = message;
    const label = this.playerLabel(player);

    if (handX === undefined || handY === undefined) {
      // console.warn(`[GamePhysics] Invalid receive message from ${label}: missing handX or handY`);
      return false;
    }

    const ball = this.room.state.volleyBall;

    // 공 위치와 손 위치 사이의 거리 계산
    const distanceX = Math.abs(ball.posX - handX);
    const distanceY = Math.abs(ball.posY - handY);
    const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);

    // PLAYER_HAND_CHECK_RADIUS 범위 내에 있으면 공을 위로 띄우기
    if (distance <= PhysicsConstants.PLAYER_HAND_CHECK_RADIUS) {
      // 위로 띄우는 속도 설정 (양수 = 위쪽)
      ball.velY = PhysicsConstants.TOSS_VELOCITY;
      ball.velX = ball.velX / 8;
      this.applyTouchOwnership(player.teamIndex);
      this.lastTouchedBySessionId = player.sessionId;
      this.cachedPredictedLandingX = this.predictBallLandingX(ball);

      // 땅 유예 상태였다면, 유효한 receive로 랠리를 이어갔으므로 groundTouchedTick 초기화
      this.groundTouchedTick = null;

      // console.log(`[GamePhysics] Ball received by ${label} at distance ${distance.toFixed(2)}`);
      return true;
    } else {
      // console.log(`[GamePhysics] receive failed: distance ${distance.toFixed(2)} > ${PhysicsConstants.PLAYER_HAND_CHECK_RADIUS} from ${label}`);
      return false;
    }
  }

  /**
   * spike 처리 (인간/AI 공통, player 기준 로그)
   * @param direction 스파이크 방향/강도 (Forward/Backward/Neutral)
   */
  handleSpike(
    player: { sessionId: string; name?: string; teamIndex?: number },
    message: { handX: number; handY: number },
    direction: SpikeDirection = SpikeDirection.Neutral
  ): void {
    const { handX, handY } = message;
    const label = this.playerLabel(player);

    if (handX === undefined || handY === undefined) {
      console.warn(
        `[GamePhysics] Invalid spike message from ${label}: missing handX or handY`
      );
      return;
    }

    const ball = this.room.state.volleyBall;

    // 공 위치와 손 위치 사이의 거리 계산
    const distanceX = Math.abs(ball.posX - handX);
    const distanceY = Math.abs(ball.posY - handY);
    const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);

    // PLAYER_HAND_CHECK_RADIUS 범위 내에 있으면 공을 위로 띄우기
    if (distance <= PhysicsConstants.PLAYER_HAND_CHECK_RADIUS) {
      const baseVel = PhysicsConstants.TOSS_VELOCITY;
      const signX = player.teamIndex === 0 ? 1 : -1;
      let velXAdd: number;
      let velYSet: number;
      if (direction === SpikeDirection.Forward) {
        // 강스파이크: 더 빠르고 멀리
        velXAdd = signX * baseVel * 1.15;
        velYSet = -baseVel * 0.55;
      } else if (direction === SpikeDirection.Backward) {
        // 뒤로 빼며 약하게: 살짝 위로 떠서 천천히 떨어짐
        velXAdd = signX * baseVel * 0.25;
        velYSet = baseVel * 0.2;
      } else {
        // 기본 스파이크
        velXAdd = signX * baseVel * 0.85;
        velYSet = -baseVel * 0.8;
      }
      ball.velX += velXAdd;
      ball.velY = velYSet;
      this.applyTouchOwnership(player.teamIndex);
      this.lastTouchedBySessionId = player.sessionId;
      this.cachedPredictedLandingX = this.predictBallLandingX(ball);

      // console.log(`[GamePhysics] Ball spiked by ${label} at distance ${distance.toFixed(2)}`);
    } else {
      // console.log(
      //   `[GamePhysics] spike failed: distance ${distance.toFixed(
      //     2
      //   )} > ${PhysicsConstants.PLAYER_HAND_CHECK_RADIUS} from ${label} (dx=${distanceX.toFixed(
      //     2
      //   )}, dy=${distanceY.toFixed(2)})`
      // );
    }
  }

  /**
   * 리소스 정리
   */
  dispose(): void {
    if (this.ballResetTimeout) {
      clearTimeout(this.ballResetTimeout);
      this.ballResetTimeout = undefined;
    }
  }
}

