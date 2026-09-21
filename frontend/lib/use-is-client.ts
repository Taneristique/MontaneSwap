import { useSyncExternalStore } from "react";

/** Client mount without useEffect setState (no cascading render lint). */
export function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
