// The two-method seam `buildTracePath` draws through. `Path2D` satisfies this structurally with
// no adapter and no cast, so production passes the real `Path2D` and pays nothing; tests drive
// a counting fixture instead, keeping the hot loop itself DOM-free and node-testable.
export interface PolylineSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
}
