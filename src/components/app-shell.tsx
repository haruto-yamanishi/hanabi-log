"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useSyncExternalStore } from "react";
import type { CurrentUser } from "@/lib/types";
import { ArrowLeftIcon, ArrowRightIcon, CalendarIcon, HomeIcon, PlusIcon, SearchIcon, SettingsIcon, UserIcon } from "@/components/icons";
import { HanabiMark } from "@/components/logo";
import { Avatar } from "@/components/ui";

const sidebarStorageKey = "hanabi-log-sidebar-collapsed";
const sidebarChangeEvent = "hanabi-log-sidebar-change";
let sidebarMemoryValue = false;

function subscribeToSidebar(callback: () => void) {
  function handleStorage(event: StorageEvent) {
    if (!event.key || event.key === sidebarStorageKey) callback();
  }

  window.addEventListener("storage", handleStorage);
  window.addEventListener(sidebarChangeEvent, callback);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(sidebarChangeEvent, callback);
  };
}

function getSidebarSnapshot() {
  try {
    return window.localStorage.getItem(sidebarStorageKey) === "true";
  } catch {
    return sidebarMemoryValue;
  }
}

function getServerSidebarSnapshot() {
  return false;
}

const navigation = [
  { href: "/", label: "ホーム", icon: HomeIcon, exact: true },
  { href: "/calendar", label: "カレンダー", icon: CalendarIcon, exact: false },
  { href: "/archive", label: "アーカイブ", icon: SearchIcon, exact: false },
  { href: "/me", label: "マイページ", icon: UserIcon, exact: false },
] as const;

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children, initialUser }: { children: ReactNode; initialUser: CurrentUser }) {
  const pathname = usePathname();
  const sidebarCollapsed = useSyncExternalStore(subscribeToSidebar, getSidebarSnapshot, getServerSidebarSnapshot);
  const user = initialUser;

  function toggleSidebar() {
    const next = !sidebarCollapsed;
    sidebarMemoryValue = next;

    try {
      window.localStorage.setItem(sidebarStorageKey, String(next));
    } catch {
      // 保存できなくても、この画面内での開閉は続ける。
    }

    window.dispatchEvent(new Event(sidebarChangeEvent));
  }

  return (
    <div className={`app-shell${sidebarCollapsed ? " app-shell--sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#main-content">本文へ移動</a>

      <aside className={`sidebar${sidebarCollapsed ? " sidebar--collapsed" : ""}`}>
        <button
          aria-expanded={!sidebarCollapsed}
          aria-label={sidebarCollapsed ? "メニューを開く" : "メニューを閉じる"}
          className="sidebar__toggle"
          onClick={toggleSidebar}
          title={sidebarCollapsed ? "メニューを開く" : "メニューを閉じる"}
          type="button"
        >
          {sidebarCollapsed ? <ArrowRightIcon /> : <ArrowLeftIcon />}
        </button>
        <div className="sidebar__brand">
          <HanabiMark />
        </div>
        <Link aria-label="日報を書く" className="button button--primary sidebar__create" href="/reports/new" title={sidebarCollapsed ? "日報を書く" : undefined}>
          <PlusIcon />
          <span>日報を書く</span>
        </Link>
        <nav aria-label="メインナビゲーション" className="sidebar__nav">
          {navigation.map(({ href, label, icon: Icon, exact }) => (
            <Link
              aria-current={isActive(pathname, href, exact) ? "page" : undefined}
              aria-label={sidebarCollapsed ? label : undefined}
              className="nav-link"
              href={href}
              key={href}
              title={sidebarCollapsed ? label : undefined}
            >
              <Icon />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar__secondary">
          {user?.role === "admin" ? (
            <Link
              aria-current={isActive(pathname, "/admin") ? "page" : undefined}
              aria-label={sidebarCollapsed ? "管理" : undefined}
              className="nav-link"
              href="/admin"
              title={sidebarCollapsed ? "管理" : undefined}
            >
              <SettingsIcon />
              <span>管理</span>
            </Link>
          ) : null}
        </div>
        <Link aria-label="マイページ" className="sidebar__profile" href="/me" title={sidebarCollapsed ? "マイページ" : undefined}>
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
        <Link aria-current={isActive(pathname, "/calendar") ? "page" : undefined} href="/calendar">
          <CalendarIcon />
          <span>カレンダー</span>
        </Link>
        <Link aria-current={isActive(pathname, "/reports/new") ? "page" : undefined} className="bottom-nav__create" href="/reports/new">
          <span><PlusIcon /></span>
          <small>書く</small>
        </Link>
        <Link aria-current={isActive(pathname, "/archive") ? "page" : undefined} href="/archive">
          <SearchIcon />
          <span>さがす</span>
        </Link>
        <Link aria-current={isActive(pathname, "/me") ? "page" : undefined} href="/me">
          <UserIcon />
          <span>マイページ</span>
        </Link>
      </nav>
    </div>
  );
}
