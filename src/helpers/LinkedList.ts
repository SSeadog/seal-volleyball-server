export class LinkedListNode<T> {
  public next: LinkedListNode<T> | null = null;

  constructor(public value: T) {}
}

/**
 * 단순 단일 연결 리스트
 * - 앞에서 꺼내기 O(1)
 * - 뒤에 넣기 O(1)
 */
export class LinkedList<T> {
  private head: LinkedListNode<T> | null = null;
  private tail: LinkedListNode<T> | null = null;
  private _length = 0;

  get length(): number {
    return this._length;
  }

  get isEmpty(): boolean {
    return this._length === 0;
  }

  /** 맨 뒤에 추가 (enqueue) */
  push(value: T): void {
    const node = new LinkedListNode(value);
    if (!this.head) {
      this.head = this.tail = node;
    } else {
      this.tail!.next = node;
      this.tail = node;
    }
    this._length++;
  }

  /** 맨 앞 요소 조회 (제거하지 않음) */
  peek(): T | undefined {
    return this.head ? this.head.value : undefined;
  }

  /** 맨 앞 요소 제거 후 반환 (dequeue) */
  shift(): T | undefined {
    if (!this.head) return undefined;
    const node = this.head;
    this.head = node.next;
    if (!this.head) {
      this.tail = null;
    }
    this._length--;
    return node.value;
  }

  /** 모든 요소 제거 */
  clear(): void {
    this.head = this.tail = null;
    this._length = 0;
  }
}

