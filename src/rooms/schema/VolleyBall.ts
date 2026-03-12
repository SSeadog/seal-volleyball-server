import { Schema, type } from "@colyseus/schema";

export class VolleyBall extends Schema {
  @type("number") posX: number = -5.64;
  @type("number") posY: number = 6.5;
  @type("number") velX: number = 0; // X축 속도
  @type("number") velY: number = 0; // Y축 속도 (중력 적용)

  /** 현재 공을 가진 팀의 teamIndex (0=왼쪽, 1=오른쪽, -1=소유 없음) */
  @type("number") owningTeam: number = -1;
  /** 같은 팀 터치 횟수 (최대 3, 다른 팀 터치 시 0으로 초기화) */
  @type("number") touchCount: number = 0;
}


