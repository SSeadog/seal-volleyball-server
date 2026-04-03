export class QueueNode<T> {
  public next: QueueNode<T> | null = null;

  constructor(public value: T) {}
}

/**
 * 단순 연결 리스트 기반 큐
 * - enqueue(뒤에 넣기) O(1)
 * - dequeue(앞에서 꺼내기) O(1)
 */
export class Queue<T> {
  private head: QueueNode<T> | null = null;
  private tail: QueueNode<T> | null = null;
  private _length = 0;

  get length(): number {
    return this._length;
  }

  get isEmpty(): boolean {
    return this._length === 0;
  }

  /** 맨 뒤에 추가 */
  enqueue(value: T): void {
    const node = new QueueNode(value);
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

  /** 맨 앞 요소 제거 후 반환 */
  dequeue(): T | undefined {
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
