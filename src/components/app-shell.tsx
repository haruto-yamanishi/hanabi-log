"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";
import type { CurrentUser } from "@/lib/types";
import { HomeIcon, PlusIcon, SearchIcon, SettingsIcon, UserIcon } from "@/components/icons";
import { HanabiMark } from "@/components/logo";
import { Avatar } from "@/components/ui";

const navigation = [
  { href: "/", label: "ホーム", icon: HomeIcon, exact: true },
  { href: "/archive", label: "アーカイブ", icon: SearchIcon, exact: false },
  { href: "/me", label: "マイページ", icon: UserIcon, exact: false },
] as const;

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children, initialUser }: { children: ReactNode; initialUser: CurrentUser }) {
  const pathname = usePathname();
  const user = initialUser;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">本文へ移動</a>

      <aside className="sidebar">
        <div className="sidebar__brand">
          <HanabiMark />
          <p>Team Hanabiの知見を、次へ。</p>
        </div>
        <Link className="button button--primary sidebar__create" href="/reports/new">
          <PlusIcon />
          日報を書く
        </Link>
        <nav aria-label="メインナビゲーション" className="sidebar__nav">
          {navigation.map(({ href, label, icon: Icon, exact }) => (
            <Link aria-current={isActive(pathname, href, exact) ? "page" : undefined} className="nav-link" href={href} key={href}>
              <Icon />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar__secondary">
          {user?.role === "admin" ? (
            <Link aria-current={isActive(pathname, "/admin") ? "page" : undefined} className="nav-link" href="/admin">
              <SettingsIcon />
              <span>管理</span>
            </Link>
          ) : null}
        </div>
        <Link className="sidebar__profile" href="/me">
          <Avatar name={user?.displayName || "Hanabiメンバー"} src={user?.avatarUrl} />
          <span>
            <strong>{user?.displayName || "Hanabiメンバー"}</strong>
            <small>{user?.role === "admin" ? "Admin" : "Member"}</small>
          </span>
        </Link>
      </aside>

      <header className="mobile-header">
        <HanabiMark compact />
        <Link aria-label="マイページを開く" href="/me">
          <Avatar name={user?.displayName || "Hanabiメンバー"} size="small" src={user?.avatarUrl} />
        </Link>
      </header>

      <main className="main-content" id="main-content">{children}</main>

      <nav aria-label="モバイルナビゲーション" className="bottom-nav">
        <Link aria-current={pathname === "/" ? "page" : undefined} href="/">
          <HomeIcon />
          <span>ホーム</span>
        </Link>
        <Link aria-current={isActive(pathname, "/archive") ? "page" : undefined} href="/archive">
          <SearchIcon />
          <span>さがす</span>
        </Link>
        <Link aria-current={isActive(pathname, "/reports/new") ? "page" : undefined} className="bottom-nav__create" href="/reports/new">
          <span><PlusIcon /></span>
          <small>書く</small>
        </Link>
        <Link aria-current={isActive(pathname, "/me") ? "page" : undefined} href="/me">
          <UserIcon />
          <span>マイページ</span>
        </Link>
      </nav>
    </div>
  );
}
