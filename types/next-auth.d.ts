import type { Role } from "@/lib/principal";

declare module "next-auth" {
  interface Session {
    appUserId?: string;
    role?: Role;
    emailVerified?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    appUserId?: string;
    role?: Role;
    emailVerified?: boolean;
  }
}
