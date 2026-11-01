import type { AuthenticatedPrincipal } from "./auth";

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthenticatedPrincipal;
    }
  }
}

export {};
