import { createContext, useContext } from "react";

// currentHomestayId: the homestay every screen is currently scoped to.
// Fixed to the user's own homestayId for admin/staff; for owner it's
// whichever homestay they picked in the header switcher.
// homestays: only populated for owner (the full list to switch between).
export const HomestayContext = createContext({
  currentHomestayId: null,
  homestays: [],
  setCurrentHomestayId: () => {},
  refreshHomestays: () => {},
});

export function useHomestay() {
  return useContext(HomestayContext);
}
