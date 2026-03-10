"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigationItems = [
  { href: "/", label: "Mi cartera" },
  { href: "/clientes", label: "Clientes" },
  { href: "/review", label: "Bandeja de trabajo" },
  { href: "/modelos", label: "Modelos AEAT" },
  { href: "/extractor", label: "Extractor" },
  { href: "/configuracion", label: "Configuración" }
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PrimaryNav() {
  const pathname = usePathname();

  return (
    <nav className="sidebar-nav">
      {navigationItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`sidebar-link${isActive(pathname, item.href) ? " active" : ""}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
