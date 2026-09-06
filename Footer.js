import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div
        data-testid="auth-loading"
        className="min-h-screen flex items-center justify-center text-parchment-muted font-cormorant italic"
      >
        <span className="animate-pulse">❖ Consulting the arcane tomes…</span>
      </div>
    );
  }
  if (user === false) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
