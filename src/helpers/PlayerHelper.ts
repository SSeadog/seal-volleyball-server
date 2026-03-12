import { PhysicsConstants } from "../constants/PhysicsConstants";
import {
  TICKS_PER_SECOND,
  SPIKE_DELAY_TICKS,
  BALL_NEAR_DISTANCE,
  BALL_VEL_Y_DONT_TOUCH_THRESHOLD,
  SPIKE_Y_TOLERANCE,
} from "../constants/AIConstants";
import type { Net } from "../physics/BallPhysics";

/** 플레이어 중심 + 네트 기준 손 오프셋으로 쓰는 최소 타입 */
export type PlayerPosition = { posX: number; posY: number };

/** 볼 위치 최소 타입 */
export type BallPosition = { posX: number; posY: number };

/** 스파이크 가능 여부 판정에 필요한 볼 상태 */
export type BallForSpike = BallPosition & {
  velX: number;
  velY: number;
  owningTeam?: number;
  touchCount?: number;
};

/** 스파이크 가능 여부 판정에 필요한 플레이어 상태 */
export type PlayerForSpike = PlayerPosition & { teamIndex: number };

/**
 * 플레이어 관련 계산 로직 (손 위치, 공까지 거리, 점프 최고점 등)을 한 곳에서 관리
 */
export class PlayerHelper {
  /** 플레이어 중심에서 손(터치 판정) X 오프셋. 네트 왼쪽 팀 +, 오른쪽 팀 - */
  static readonly HAND_OFFSET_X = PhysicsConstants.PLAYER_HAND_OFFSET_X;

  /** 네트 기준 왼쪽에 있으면 true */
  static isOnLeft(player: PlayerPosition, net: Net): boolean {
    return player.posX < net.x;
  }

  /** 손(터치 판정) X 좌표 */
  static getHandX(player: PlayerPosition, net: Net): number {
    return player.posX + (this.isOnLeft(player, net) ? this.HAND_OFFSET_X : -this.HAND_OFFSET_X);
  }

  /** 손(터치 판정) 위치 { handX, handY } */
  static getHandPosition(player: PlayerPosition, net: Net): { handX: number; handY: number } {
    return {
      handX: this.getHandX(player, net),
      handY: player.posY,
    };
  }

  /** 플레이어 손 위치 ~ 공 중심 거리 (net 필요) */
  static getDistanceToBall(
    player: PlayerPosition,
    ball: BallPosition,
    net: Net
  ): number {
    const handX = this.getHandX(player, net);
    const handY = player.posY;
    return Math.sqrt(
      (ball.posX - handX) ** 2 + (ball.posY - handY) ** 2
    );
  }

  /** 손 위치 ~ 공: X/Y 차이와 직선 거리 */
  static getDistanceFromHandToBall(
    player: PlayerPosition,
    ball: BallPosition,
    net: Net
  ): { distX: number; distY: number; distance: number } {
    const handX = this.getHandX(player, net);
    const handY = player.posY;
    const distX = Math.abs(ball.posX - handX);
    const distY = Math.abs(ball.posY - handY);
    const distance = Math.sqrt(distX * distX + distY * distY);
    return { distX: ball.posX - handX, distY: ball.posY - handY, distance };
  }

  /** 점프 최고점 Y (현재 posY 기준) */
  static getJumpPeakY(posY: number): number {
    return (
      posY +
      PhysicsConstants.PLAYER_JUMP_VELOCITY ** 2 /
        (2 * Math.abs(PhysicsConstants.GRAVITY))
    );
  }

  /**
   * 현재 위치·상태로 스파이크 가능한지 여부
   * (같은 팀 2터치 이상, 손-공 거리/세로 허용 오차, 공이 위로 빠르게 올라가는 중이 아님)
   * net이 없으면 false
   */
  static canSpike(
    player: PlayerForSpike,
    ball: BallForSpike,
    net: Net | undefined
  ): boolean {
    if (!net) return false;
    const ballGoingUpFast = ball.velY >= BALL_VEL_Y_DONT_TOUCH_THRESHOLD;
    if (ballGoingUpFast) return false;

    const sameTeam =
      ball.owningTeam != null &&
      ball.owningTeam >= 0 &&
      ball.owningTeam === player.teamIndex;
    if (!sameTeam) return false;

    const touchCount = ball.touchCount ?? 0;
    if (touchCount < 2) return false;

    const tSec = SPIKE_DELAY_TICKS / TICKS_PER_SECOND;

    // 스파이크 시점에 공이 있을 x 좌표 예측 (수평 가속도는 없다고 가정)
    const ballXAtSpikeTime = ball.posX + ball.velX * tSec;

    // 플레이어 손의 현재 x와, 스파이크 시점까지 이동 가능한 수평 거리
    const handXNow = this.getHandX(player, net);
    const maxMoveX = PhysicsConstants.PLAYER_MOVE_SPEED * tSec;

    // 스파이크 시점에 손이 도달할 수 있는 x 구간 [minReachX, maxReachX]
    const minReachX = handXNow - maxMoveX;
    const maxReachX = handXNow + maxMoveX;

    // 공의 예상 x가 이 구간에서 얼마나 떨어져 있는지 계산
    const clampedX =
      ballXAtSpikeTime < minReachX
        ? minReachX
        : ballXAtSpikeTime > maxReachX
        ? maxReachX
        : ballXAtSpikeTime;
    const horizGap = Math.abs(ballXAtSpikeTime - clampedX);

    // 수평으로도 도달 불가능하면 스파이크 불가
    if (horizGap >= BALL_NEAR_DISTANCE) return false;

    const g = PhysicsConstants.GRAVITY;
    const playerJumpPeakY = this.getJumpPeakY(player.posY);
    const ballYAtSpikeTime =
      ball.posY + ball.velY * tSec + 0.5 * g * tSec * tSec;
    const dyAtSpike = Math.abs(playerJumpPeakY - ballYAtSpikeTime);
    if (dyAtSpike >= SPIKE_Y_TOLERANCE) return false;

    return true;
  }

  /**
   * 예상 착지점으로 이동할 때 목표 X (네트를 넘지 않도록 제한)
   */
  static getTargetXForLanding(
    net: Net,
    landingX: number,
    isOnLeft: boolean,
    arrivalDistance: number
  ): number {
    const netLeft = net.x - net.width / 2;
    const netRight = net.x + net.width / 2;
    return isOnLeft
      ? Math.min(landingX, netLeft - arrivalDistance)
      : Math.max(landingX, netRight + arrivalDistance);
  }
}
