// INTENT: Fire-and-forget work must still have a local rejection boundary. Without
// one, an auxiliary failure escapes as unhandledRejection and can destabilize the
// interactive process long after the originating action has returned.
export function runDetached(
  task: Promise<unknown>,
  onError: (error: unknown) => void = () => {},
): void {
  void task.catch(onError)
}
