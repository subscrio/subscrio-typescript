import { ConflictError } from "../../application/errors/index.js";

/** Keep foreign-key retention failures understandable at the public API boundary. */
export async function accountingDelete(
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    let cause: unknown = error;
    const seen = new Set<unknown>();
    while (cause && typeof cause === "object" && !seen.has(cause)) {
      seen.add(cause);
      if ("code" in cause && cause.code === "23503")
        throw new ConflictError(
          "Cannot delete an entity with retained accounting or related history. Archive it instead.",
        );
      cause = "cause" in cause ? cause.cause : undefined;
    }
    throw error;
  }
}
