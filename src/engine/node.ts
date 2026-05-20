export abstract class Node<I = unknown, O = unknown> {
  abstract execute(input: I): Promise<O>;
}
