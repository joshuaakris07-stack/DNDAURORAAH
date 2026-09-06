import React from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";

import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Sheet from "./pages/Sheet";
import AdminDashboard from "./pages/AdminDashboard";
import AdminLibrary from "./pages/AdminLibrary";
import Account from "./pages/Account";

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/sheet"
              element={
                <ProtectedRoute>
                  <Sheet />
                </ProtectedRoute>
              }
            />
            <Route path="/admin" element={
              <ProtectedRoute>
                <AdminDashboard />
              </ProtectedRoute>
            } />
            <Route path="/admin/library" element={
              <ProtectedRoute>
                <AdminLibrary />
              </ProtectedRoute>
            } />
            <Route path="/account" element={
              <ProtectedRoute>
                <Account />
              </ProtectedRoute>
            } />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "#1A1514",
              color: "#F2E8D5",
              border: "1px solid #3A2E28",
              borderRadius: "2px",
              fontFamily: "EB Garamond, serif",
            },
          }}
        />
      </AuthProvider>
    </div>
  );
}

export default App;
