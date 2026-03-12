/**
 * 게임 물리 상수 정의
 */
export class PhysicsConstants {
  // 중력 및 시간
  static readonly GRAVITY = -9.8; // 중력 가속도 (m/s²)
  static readonly TARGET_FPS = 60; // 목표 FPS
  static readonly DELTA_TIME = 16; // 약 60 FPS 기준 deltaTime (MS)
  
  // 볼 관련
  static readonly BALL_RADIUS = 0.3; // 볼의 반지름
  static readonly TOSS_VELOCITY = 10.0; // 공을 위로 띄우는 속도
  
  // 충돌 및 물리
  static readonly BOUNCE_FACTOR = 0.7; // 탄성 계수 (0.7 = 70% 에너지 보존)
  static readonly FRICTION = 0.95; // 마찰 계수
  
  // 속도 임계값 (이보다 작으면 정지)
  static readonly VELOCITY_THRESHOLD = 0.1;
  
  // 플레이어 관련
  static readonly PLAYER_JUMP_VELOCITY = 7.66; // 1.5m 점프를 위한 초기 속도 (√(2 * 9.8 * 3))
  static readonly PLAYER_MOVE_SPEED = 4.0; // 플레이어 이동 속도 (m/s)
  static readonly PLAYER_VELOCITY_DECAY = 0.75; // 좌우 입력 없을 때 수평 속도 감쇠 비율
  static readonly PLAYER_GROUND_Y = -0.5; // 땅의 Y 좌표 (땅 중심이 -0.5, 높이 1이므로 상단은 0)
  static readonly PLAYER_SIZE_Y = 1.8; // 플레이어 높이
  static readonly PLAYER_HAND_CHECK_RADIUS = 0.95; // 손 체크 반경 (공 상호작용 범위, Toss/Receive/Spike 공통)
  /** 플레이어 중심에서 손(터치 판정 위치)까지의 X 오프셋. 왼쪽 팀 +, 오른쪽 팀 - */
  static readonly PLAYER_HAND_OFFSET_X = 1.2;
}

