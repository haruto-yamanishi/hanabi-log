import type { DefaultSession, DefaultUser } from "next-auth";
import type { MemberRole } from "@/lib/types";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      slackUserId: string;
      role: MemberRole;
      isActive: boolean;
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    slackTeamId?: string;
    slackUserId?: string;
    role?: MemberRole;
    isActive?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    memberId?: string;
    slackUserId?: string;
    role?: MemberRole;
    isActive?: boolean;
    avatarUrl?: string | null;
  }
}
