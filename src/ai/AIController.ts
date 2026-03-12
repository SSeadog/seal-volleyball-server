import { PhysicsConstants } from "../constants/PhysicsConstants";
import {
  SPIKE_DELAY_TICKS,
  ARRIVAL_DISTANCE,
  BALL_VEL_Y_DONT_TOUCH_THRESHOLD,
} from "../constants/AIConstants";
import { AIControllerContext } from "./AIControllerContext";
import { PlayerHelper } from "../helpers/PlayerHelper";

/** AI 행동 상태 */
export type AIState =
  | "idle"
  | "move_to_landing"
  | "receive"
  | "toss"
  | "wait_spike"
  | "spike";

export class AIController {
  private state: Map<string, AIState> = new Map();
  /** 스파이크 대기: sessionId -> 해당 틱에 spike 입력할 것 */
  private spikePendingUntilTick: Map<string, number> = new Map();
  /** 각 플레이어의 '기본 대기 위치' X (처음 호출 시점의 posX로 고정) */
  private homeX: Map<string, number> = new Map();

  /**
   * 이번 프레임 AI 입력 결정 → lastInput 갱신
   */
  computeInput(ctx: AIControllerContext): void {
    const { player, lastInput, lastTouchedBySessionId } = ctx;

    lastInput.toss = false;
    lastInput.spike = false;
    lastInput.receive = false;
    lastInput.jump = false;

    // 현재 플레이어의 기본 대기 위치(homeX) 초기화 (최초 한 번)
    if (!this.homeX.has(player.sessionId)) {
      this.homeX.set(player.sessionId, player.posX);
    }

    if (lastTouchedBySessionId === player.sessionId) {
      this.state.set(player.sessionId, "idle");
      lastInput.left = false;
      lastInput.right = false;
      return;
    }

    const currentState = this.state.get(player.sessionId) ?? "idle";
    const nextState = this.stepFiniteStateMachine(currentState, ctx);
    this.state.set(player.sessionId, nextState);
    if (nextState !== currentState) {
      console.log(`[AIController] ${player.sessionId} -> ${nextState}`);
    }
  }

  /**
   * 현재 상태 + 환경에 따라 다음 상태와 입력을 결정하는 FSM 스텝
   */
  private stepFiniteStateMachine(
    currentState: AIState,
    ctx: AIControllerContext
  ): AIState {
    const { player, ball, net, lastInput, predictedLandingX, currentTick = 0 } =
      ctx;

    // 1. 공/플레이어/네트 상태 기반 공통 값 계산
    const ballGoingUpFast =
      ball.velY >= BALL_VEL_Y_DONT_TOUCH_THRESHOLD;
    const distToBall = net
      ? PlayerHelper.getDistanceToBall(player, ball, net)
      : Infinity;
    const sameTeam =
      ball.owningTeam >= 0 && ball.owningTeam === player.teamIndex;
    const touchCount = ball.touchCount ?? 0;
    const landingX = predictedLandingX ?? null;
    const canSpike = PlayerHelper.canSpike(player, ball, net);
    const ballOwnedByOpponent =
      ball.owningTeam !== undefined &&
      ball.owningTeam >= 0 &&
      ball.owningTeam !== player.teamIndex;

    // 2. 현재 상태별 처리
    // 2-1. wait_spike: 이미 점프한 상태에서 스파이크 대기 중
    //     - tick이 도달하면 spike 상태로 전이
    //     - 그 전까지는 공의 x 위치를 따라 이동만 수행
    if (currentState === "wait_spike") {
      const pendingTick = this.spikePendingUntilTick.get(player.sessionId);
      if (pendingTick !== undefined && currentTick >= pendingTick) {
        this.spikePendingUntilTick.delete(player.sessionId);
        return "spike";
      }

      if (net) {
        const handX = PlayerHelper.getHandX(player, net);
        const dxToBallX = ball.posX - handX;
        if (
          Math.abs(dxToBallX) >
          PhysicsConstants.PLAYER_HAND_CHECK_RADIUS / 2
        ) {
          lastInput.left = dxToBallX < 0;
          lastInput.right = dxToBallX > 0;
        } else {
          lastInput.left = false;
          lastInput.right = false;
        }
      } else {
        lastInput.left = false;
        lastInput.right = false;
      }
      // tick에 의한 상태 전이는 computeInput에서만 처리
      return "wait_spike";
    }

    // 2-2. spike: 실제 스파이크 입력을 한 틱 동안만 발생시키고 idle로 복귀
    if (currentState === "spike") {
      lastInput.spike = true;
      return "idle";
    }

    // 3. (idle / move_to_landing / receive / toss) 상태에서의 스파이크 시작 규칙
    //    조건: 스파이크 가능 위치/타이밍이면 → 상태: "wait_spike", 입력: jump=true
    if (canSpike) {
      lastInput.jump = true;
      lastInput.spike = false;
      this.spikePendingUntilTick.set(
        player.sessionId,
        currentTick + SPIKE_DELAY_TICKS
      );
      return "wait_spike";
    }

    // 4. 공이 손 근처에 있을 때의 상태 전이 규칙
    //    - 상대 팀이면 → 상태: "receive", 입력: receive=true
    //    - 우리 팀 첫 터치면 → 상태: "toss", 입력: toss=true
    //    - 그 외(우리 팀 2터치 이상인데 스파이크 불가) → 상태: "idle"
    if (!ballGoingUpFast && distToBall <= PhysicsConstants.PLAYER_HAND_CHECK_RADIUS) {
      if (!sameTeam) {
        lastInput.left = false;
        lastInput.right = false;
        lastInput.receive = true;
        return "receive";
      }

      if (touchCount === 1) {
        lastInput.left = false;
        lastInput.right = false;
        lastInput.toss = true;
        return "toss";
      }

      lastInput.left = false;
      lastInput.right = false;
      return "idle";
    }

    // 5. 그 외(공이 멀리 있거나 위로 빠르게 올라가는 중)의 상태 전이 규칙
    //    - 공이 상대 팀 소유일 때: 자신의 기본 위치(homeX)로 복귀 후 대기
    //    - 우리 팀 소유일 때: 유효한 착지점/네트가 있으면 → 상태: "move_to_landing", 입력: 좌우 이동
    //      없으면 → 상태: "idle"
    lastInput.receive = false;

    // 5-1. 상대팀 공인 경우: homeX 기준으로 이동
    if (ballOwnedByOpponent) {
      const homeX = this.homeX.get(player.sessionId) ?? player.posX;

      if (net) {
        const handX = PlayerHelper.getHandX(player, net);
        const dxHome = homeX - handX;

        if (Math.abs(dxHome) > ARRIVAL_DISTANCE) {
          lastInput.left = dxHome < 0;
          lastInput.right = dxHome > 0;
          return "move_to_landing";
        }
      }

      lastInput.left = false;
      lastInput.right = false;
      return "idle";
    }

    // 5-2. 우리 팀 공인 경우: 예상 착지점으로 이동
    if (landingX !== null && net) {
      const isOnLeft = PlayerHelper.isOnLeft(player, net);
      const targetX = PlayerHelper.getTargetXForLanding(
        net,
        landingX,
        isOnLeft,
        ARRIVAL_DISTANCE
      );
      const dx = targetX - PlayerHelper.getHandX(player, net);

      if (Math.abs(dx) > ARRIVAL_DISTANCE) {
        lastInput.left = dx < 0;
        lastInput.right = dx > 0;
        return "move_to_landing";
      }
    }

    lastInput.left = false;
    lastInput.right = false;
    return "idle";
  }
}
