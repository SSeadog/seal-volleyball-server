import { PhysicsConstants } from "./PhysicsConstants";

/** tickCount 기준 초당 틱 수 (간단히 TARGET_FPS 사용) */
export const TICKS_PER_SECOND = PhysicsConstants.TARGET_FPS;

/** 점프 최고점까지 걸리는 틱 수 (v0/|g| * TICKS_PER_SECOND) */
export const SPIKE_DELAY_TICKS = Math.ceil(
  (PhysicsConstants.PLAYER_JUMP_VELOCITY / Math.abs(PhysicsConstants.GRAVITY)) *
    TICKS_PER_SECOND
);

/** 공이 이 거리 이하면 '가까이 있음'으로 보고 리시브/토스/스파이크 시도, 넘으면 예상 착지점으로 이동 */
export const BALL_NEAR_DISTANCE =
  PhysicsConstants.PLAYER_HAND_CHECK_RADIUS * 1.5;

/** 예상 착지점 도착으로 판단하는 거리 */
export const ARRIVAL_DISTANCE = 0.5;

/** 공이 이 속도 이상으로 위로 올라가면 터치하지 않음 (velY 양수 = 위쪽) */
export const BALL_VEL_Y_DONT_TOUCH_THRESHOLD = 4;

/** 스파이크 판정 시 점프 최고점과 공 Y 위치 허용 오차 (세로 방향만, 손 반경의 절반으로 축소) */
export const SPIKE_Y_TOLERANCE =
  PhysicsConstants.PLAYER_HAND_CHECK_RADIUS * 0.5;

