export type Role = "admin" | "user";

export type AppSession = {
  userId: string;
  email: string;
  role: Role;
  emailVerified: boolean;
  authMode: "shared" | "google";
};
