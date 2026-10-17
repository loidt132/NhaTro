import { createContext, useContext } from "react";

export const AuthContext = createContext({ user: null, logout: () => {} });

export function useAuth() {
  return useContext(AuthContext);
}
