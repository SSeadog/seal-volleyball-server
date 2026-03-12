import { Net } from "../physics/BallPhysics";
import { PlayerInputData } from "../rooms/schema/Player";
import { VolleyBall } from "../rooms/schema/VolleyBall";

export interface AIControllerContext {
  player: { sessionId: string; posX: number; posY: number; teamIndex: number };
  /** state의 volleyBall 참조 */
  ball: VolleyBall;
  net: Net | undefined;
  lastInput: PlayerInputData;
  /** BallPhysics에서 계산·캐시한 예상 착지 X (캐시 없을 때는 BallPhysics.predictBallLandingX로 채워서 전달) */
  predictedLandingX?: number | null;
  /** 마지막으로 공을 터치한 플레이어의 sessionId (본인이면 가만히 있음) */
  lastTouchedBySessionId?: string;
  /** 현재 시뮬레이션 틱 (스파이크 시점 지연 계산용) */
  currentTick?: number;
}