import "server-only";
import type { Member, PublicMember } from "@/lib/types";

export function toPublicMember(member: Member): PublicMember {
  return {
    id: member.id,
    displayName: member.displayName,
    avatarUrl: member.avatarUrl ?? null,
    role: member.role,
  };
}
