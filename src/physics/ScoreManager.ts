import { Room } from "@colyseus/core";
import { GameRoomState } from "../rooms/schema/GameRoomState";

/** 득점 팀 (0=left, 1=right) */
export type ScoringTeam = 0 | 1;

/** 공 정보 (점수 판정에 필요한 필드만) */
export interface BallSnapshot {
  posX: number;
  owningTeam: number;
  touchCount: number;
}

/**
 * 점수 계산 및 판정 전담 클래스
 * - 4번째 터치 실점, 땅 착지(코트 안/밖) 판정, 점수 반영 및 judge 브로드캐스트
 */
export class ScoreManager {
  /** 코트 X 경계 (네트 0 기준, 절반 코트 폭). 이 안이면 코트 안, 밖이면 코트 밖 */
  private static readonly COURT_HALF_WIDTH = 15;

  /** 마지막 득점 팀 (0=left, 1=right). 볼 리셋 위치 결정에 사용 */
  private lastScoringTeam: ScoringTeam = 0;

  constructor(private room: Room<GameRoomState>) {}

  /** 마지막 득점 팀 (볼 초기 위치 결정용) */
  getLastScoringTeam(): ScoringTeam {
    return this.lastScoringTeam;
  }

  /**
   * 4번째 터치(3번 초과 터치) 시 득점 팀 반환. 마지막 터치 팀이 실점 → 상대 득점
   */
  getScoringTeamForFourTouches(ball: BallSnapshot): ScoringTeam | null {
    const touchCount = ball.touchCount ?? 0;
    if (touchCount !== 4) return null;
    const lastTouchTeam = ball.owningTeam ?? -1;
    return lastTouchTeam === 0 ? 1 : 0;
  }

  /**
   * 땅 착지 시 득점 팀 반환
   * - 코트 안: 떨어진 쪽 코트 팀 실점 → 상대 득점
   * - 코트 밖: 마지막 터치 팀 실점 → 상대 득점
   */
  getScoringTeamForGroundTouch(ball: BallSnapshot, netX: number): ScoringTeam {
    const inCourtLeft =
      -ScoreManager.COURT_HALF_WIDTH <= ball.posX && ball.posX < netX;
    const inCourtRight =
      netX <= ball.posX && ball.posX <= ScoreManager.COURT_HALF_WIDTH;
    const inCourt = inCourtLeft || inCourtRight;

    if (inCourt) {
      return ball.posX < netX ? 1 : 0;
    }
    const lastTouchTeam = ball.owningTeam ?? -1;
    return lastTouchTeam === 0 ? 1 : 0;
  }

  /**
   * 득점 적용: state 점수 증가, lastScoringTeam 저장, judge 브로드캐스트, 리셋 스케줄 콜백 호출
   * @param scoringTeam 득점 팀 (0=left, 1=right)
   * @param scheduleReset 리셋 예약 콜백 (예: (delayMs) => setTimeout(() => resetBall(), delayMs))
   */
  applyScoreAndReset(
    scoringTeam: ScoringTeam,
    scheduleReset: (delayMs: number) => void
  ): void {
    const state = this.room.state;
    if (scoringTeam === 0) {
      state.leftTeamScore++;
    } else {
      state.rightTeamScore++;
    }
    this.lastScoringTeam = scoringTeam;
    console.log(
      `[ScoreManager] 점수 판정: ${scoringTeam === 0 ? "left" : "right"} 팀 득점 → left ${state.leftTeamScore} : ${state.rightTeamScore} right`
    );
    this.room.broadcast("judge", scoringTeam);
    scheduleReset(3000);
  }

  /** 코트 경계값 (다른 모듈에서 코트 in/out 판정 시 필요 시 사용) */
  static getCourtHalfWidth(): number {
    return ScoreManager.COURT_HALF_WIDTH;
  }
}
