export type UserRole =
  | "DONOR"
  | "TEACHER"
  | "ADMIN"
  | "SCHOOL_REPRESENTATIVE";

export type UserStatus =
  | "PENDING_VERIFICATION"
  | "ACTIVE"
  | "SUSPENDED";

export interface AuthenticatedPrincipal {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: Date | null;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: string | null;
}
