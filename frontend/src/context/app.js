import { createContext, useContext } from "react";

export const AppCtx = createContext(null);

/** Shared app state and actions (see AppProvider). */
export const useApp = () => useContext(AppCtx);
