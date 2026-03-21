import { Schema, type } from "@colyseus/schema";
import { PhysicsConstants } from "../../constants/PhysicsConstants";
import { LinkedList } from "../../helpers/LinkedList";

export class Player extends Schema {
  @type("string") sessionId: string = "";
  @type("string") name: string = "";
  @type("number") playerIndex: number = 0;
  /** 팀 인덱스 (0 = 네트 기준 왼쪽, 1 = 오른쪽) */
  @type("number") teamIndex: number = 0;
  @type("boolean") isAI: boolean = false;
  @type("boolean") isReady: boolean = false;
  @type("boolean") isInMatchQueue: boolean = false; // 매칭 큐에 등록되어 있는지
  
  inputQueue: LinkedList<PlayerInputData> = new LinkedList<PlayerInputData>();

  // 플레이어 좌표
  @type("number") posX: number = 0;
  @type("number") posY: number = 0;
  
  // 플레이어 크기 및 오프셋
  @type("number") offsetX: number = 0;
  @type("number") offsetY: number = 0;
  @type("number") sizeX: number = 3.67;
  @type("number") sizeY: number = PhysicsConstants.PLAYER_SIZE_Y;
  
  constructor(sessionId?: string, name?: string, isAI: boolean = false) {
    super();
    if (sessionId) this.sessionId = sessionId;
    if (name) this.name = name;
    this.isAI = isAI;
  }
  
}

export interface PlayerInputData {
  tick?: number;
  sessionId: string;
  left: boolean;
  right: boolean;
  jump: boolean;
  receive: boolean;
  toss: boolean;
  spike: boolean;
}