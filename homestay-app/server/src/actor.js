// Who is performing the current request, so src/db.js can stamp created_by /
// updated_by on every write without every route passing the user id around.
// requireAuth (auth.js) runs the rest of the request inside actorStore.run().
import { AsyncLocalStorage } from "node:async_hooks";

export const actorStore = new AsyncLocalStorage();

// 'system' = a write with no logged-in user (seed script, imports, background jobs).
export const currentActor = () => actorStore.getStore() || "system";
