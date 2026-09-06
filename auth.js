import React from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  return (
    <header
      data-testid="site-header"
      className="fixed top-0 inset-x-0 z-50 backdrop-blur-xl bg-ink/80 border-b border-edge"
    >
      <div className="max-w-6xl mx-auto px-6 sm:px-10 py-4 flex items-center justify-between">
        <Link to="/" data-testid="brand-link" className="flex items-center gap-3 group">
          <span className="text-gold text-lg leading-none group-hover:animate-pulse">❖</span>
          <span className="font-cinzel text-parchment tracking-[0.25em] text-sm uppercase">
            Aurora
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-3 font-cinzel text-[12px] tracking-[0.2em] uppercase">
          {user && user !== null && user !== false ? (
            <>
              <NavLink
                to="/dashboard"
                data-testid="nav-dashboard"
                className={({ isActive }) =>
                  `px-3 py-2 transition-colors ${isActive ? "text-gold" : "text-parchment-muted hover:text-parchment"}`
                }
              >
                Codex
              </NavLink>
              <NavLink
                to="/sheet"
                data-testid="nav-sheet"
                className={({ isActive }) =>
                  `px-3 py-2 transition-colors ${isActive ? "text-gold" : "text-parchment-muted hover:text-parchment"}`
                }
              >
                Sheet
              </NavLink>
              {user.role === "admin" && (
                <NavLink
                  to="/admin"
                  data-testid="nav-admin"
                  className={({ isActive }) =>
                    `px-3 py-2 transition-colors ${isActive ? "text-crimson" : "text-parchment-muted hover:text-crimson"}`
                  }
                >
                  Vault
                </NavLink>
              )}
              {user.role === "admin" && (
                <NavLink
                  to="/admin/library"
                  data-testid="nav-library"
                  className={({ isActive }) =>
                    `px-3 py-2 transition-colors ${isActive ? "text-crimson" : "text-parchment-muted hover:text-crimson"}`
                  }
                >
                  Library
                </NavLink>
              )}
              <NavLink
                to="/account"
                data-testid="nav-account"
                className={({ isActive }) =>
                  `hidden sm:inline px-3 py-2 transition-colors font-cormorant italic text-sm normal-case tracking-normal ${isActive ? "text-gold" : "text-parchment-dim hover:text-parchment"}`
                }
              >
                {user.name || user.username}
              </NavLink>
              <button
                onClick={handleLogout}
                data-testid="logout-button"
                className="px-3 py-2 text-parchment-muted hover:text-crimson transition-colors btn-press"
              >
                Logout
              </button>
            </>
          ) : user === false ? (
            <>
              <Link
                to="/login"
                data-testid="nav-login"
                className="px-3 py-2 text-parchment-muted hover:text-parchment transition-colors"
              >
                Enter
              </Link>
              <Link
                to="/register"
                data-testid="nav-register"
                className="px-4 py-2 border border-gold/60 text-gold hover:bg-gold/10 transition-colors btn-press"
              >
                Begin
              </Link>
            </>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
