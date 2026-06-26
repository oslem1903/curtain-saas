import React, { useEffect } from "react";
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { App as CapacitorApp } from "@capacitor/app";
import { Layout } from "./layouts/Layout";
import { RoleProvider, useRole } from "./context/RoleContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import TenantGuard from "./components/TenantGuard";
import SuperAdminGuard from "./components/SuperAdminGuard";
import ModuleGate from "./components/ModuleGate";
import SignupWithCode from "./pages/SignupWithCode";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import Unauthorized from "./pages/Unauthorized";
import Locked from "./pages/Locked";
import NewSupplier from "./pages/NewSupplier";
import { Dashboard } from "./pages/Dashboard";
import Customers from "./pages/Customers";
import Orders from "./pages/Orders";
import NewOrder from "./pages/NewOrder";
import NewAppointment from "./pages/NewAppointment";
import OrderDetail from "./pages/OrderDetail";
import TodayRoute from "./pages/TodayRoute";
import FieldDashboard from "./pages/FieldDashboard";
import FieldCustomers from "./pages/FieldCustomers";
import MeasurementEntry from "./pages/MeasurementEntry";
import AppointmentDetail from "./pages/AppointmentDetail";
import { Suppliers } from "./pages/Suppliers";
import { Accounting } from "./pages/Accounting";
import { Settings } from "./pages/Settings";
import SupplierLedger from "./pages/SupplierLedger";
import Products from "./pages/Products";
import Invoices from "./pages/Invoices";
import InvoiceDetail from "./pages/InvoiceDetail";
import StaffManagement from "./pages/StaffManagement";
import BranchManagement from "./pages/BranchManagement";
import SuperAdminTrials from "./pages/SuperAdminTrials";
import SuperAdminCompanies from "./pages/SuperAdminCompanies";
import VisualPreviews from "./pages/VisualPreviews";
import CatalogManagement from "./pages/CatalogManagement";
import { ExpensesPage, IncomePage, ReportsPage, TaxPage } from "./pages/AccountingSubPages";
import SuperAdminSupport from "./pages/SuperAdminSupport";
import SuperAdminUpdates from "./pages/SuperAdminUpdates";
import SuperAdminNotifications from "./pages/SuperAdminNotifications";
import SuperAdminMobileManagement from "./pages/SuperAdminMobileManagement";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { canAccess, type AppRole } from "./auth/roles";

function defaultPathForRole(role: AppRole | "unknown") {
  if (role === "super_admin") return "/super-admin/companies";
  if (role === "accountant") return "/accounting";
  if (role === "installer") return "/field";
  if (role === "admin") return "/dashboard";
  return "/login";
}

function RoleGate({
  allow,
  children,
}: {
  allow: Array<AppRole>;
  children: React.ReactNode;
}) {
  const { effectiveRole } = useRole();

  if (effectiveRole === "unknown") {
    return <Navigate to="/login" replace />;
  }

  const isAllowed = canAccess(effectiveRole, allow);

  if (!isAllowed) {
    return <Navigate to={defaultPathForRole(effectiveRole)} replace />;
  }

  return <>{children}</>;
}

function HomeRedirect() {
  const { status, role } = useAuth();

  if (status === "loading") return <div style={{ padding: 16 }}>Yönlendirme hazırlanıyor...</div>;
  if (status === "unauthenticated") return <Navigate to="/login" replace />;
  if (status === "unauthorized") return <Navigate to="/unauthorized" replace />;
  if (status === "locked") return <Navigate to="/locked" replace />;

  return <Navigate to={defaultPathForRole(role)} replace />;
}

function AndroidBackButtonHandler() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const sub = CapacitorApp.addListener("backButton", () => {
      if (location.pathname !== "/dashboard") {
        navigate(-1);
      }
    });

    return () => {
      sub.then((listener) => listener.remove());
    };
  }, [location.pathname, navigate]);

  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <AuthProvider>
          <AndroidBackButtonHandler />
          <Routes>
        {/* PUBLIC */}
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/unauthorized" element={<Unauthorized />} />
        <Route path="/locked" element={<Locked />} />

        {/* PROTECTED */}
        <Route path="/join" element={<SignupWithCode />} />
        <Route path="/join/:token" element={<SignupWithCode />} />
        <Route
          path="/"
          element={
            <TenantGuard>
              <RoleProvider>
                <Layout />
              </RoleProvider>
            </TenantGuard>
          }
        >
          <Route
            path="/products"
            element={
              <RoleGate allow={["admin"]}>
                <Products />
              </RoleGate>
            }
          />
          {/* "/" açılınca dashboard'a */}
          <Route index element={<HomeRedirect />} />

          {/* Admin + Staff */}
          <Route
            path="app/dashboard"
            element={
              <TenantGuard mode="customer">
              <RoleGate allow={["admin", "installer", "accountant"]}>
                  <Dashboard />
                </RoleGate>
              </TenantGuard>
            }
          />
          <Route
            path="dashboard"
            element={
              <RoleGate allow={["admin", "installer", "accountant"]}>
                <Dashboard />
              </RoleGate>
            }
          />

          <Route
            path="field"
            element={
              <RoleGate allow={["admin", "installer"]}>
                <FieldDashboard />
              </RoleGate>
            }
          />

          <Route
            path="measurements/new"
            element={
              <RoleGate allow={["admin", "installer"]}>
                <ModuleGate module="measurements">
                  <MeasurementEntry />
                </ModuleGate>
              </RoleGate>
            }
          />

          <Route
            path="field/customers"
            element={
              <RoleGate allow={["admin", "installer"]}>
                <FieldCustomers />
              </RoleGate>
            }
          />

          <Route
            path="orders"
            element={
              <RoleGate allow={["admin"]}>
                <ModuleGate module="orders">
                  <Orders />
                </ModuleGate>
              </RoleGate>
            }
          />
          <Route
            path="orders/new"
            element={
              <RoleGate allow={["admin", "installer"]}>
                <ModuleGate module="orders">
                  <NewOrder />
                </ModuleGate>
              </RoleGate>
            }
          />
          <Route
            path="orders/:id"
            element={
              <RoleGate allow={["admin", "installer"]}>
                <ModuleGate module="orders">
                  <OrderDetail />
                </ModuleGate>
              </RoleGate>
            }
          />

          <Route
            path="appointments/new"
            element={
              <RoleGate allow={["admin"]}>
                <NewAppointment />
              </RoleGate>
            }
          />
          <Route
            path="appointments/:id"
            element={
              <RoleGate allow={["admin", "installer"]}>
                <AppointmentDetail />
              </RoleGate>
            }
          />

          <Route
            path="route/today"
            element={
              <RoleGate allow={["admin", "installer"]}>
                <ModuleGate module="installation">
                  <TodayRoute />
                </ModuleGate>
              </RoleGate>
            }
          />

          <Route
            path="visual-previews"
            element={
              <RoleGate allow={["admin", "installer"]}>
                <VisualPreviews />
              </RoleGate>
            }
          />

          <Route
            path="catalogs"
            element={
              <RoleGate allow={["admin"]}>
                <CatalogManagement />
              </RoleGate>
            }
          />

          {/* Sadece Admin */}
          <Route
            path="customers"
            element={
              <RoleGate allow={["admin"]}>
                <ModuleGate module="customers">
                  <Customers />
                </ModuleGate>
              </RoleGate>
            }
          />
          <Route
            path="suppliers"
            element={
              <RoleGate allow={["admin", "accountant"]}>
                <ModuleGate module="suppliers">
                  <Suppliers />
                </ModuleGate>
              </RoleGate>
            }
          />
          <Route
            path="suppliers/new"
            element={
              <RoleGate allow={["admin", "accountant"]}>
                <ModuleGate module="suppliers">
                  <NewSupplier />
                </ModuleGate>
              </RoleGate>
            }
          />
          <Route
            path="accounting"
            element={
              <RoleGate allow={["admin", "accountant"]}>
                <ModuleGate module="accounting">
                  <Accounting />
                </ModuleGate>
              </RoleGate>
            }
          />
          <Route
            path="income"
            element={
              <RoleGate allow={["admin", "accountant"]}>
                <ModuleGate module="accounting">
                  <IncomePage />
                </ModuleGate>
              </RoleGate>
            }
          />
          <Route
            path="expenses"
            element={
              <RoleGate allow={["admin", "accountant"]}>
                <ModuleGate module="expenses">
                  <ExpensesPage />
                </ModuleGate>
              </RoleGate>
            }
          />
          <Route
            path="tax"
            element={
              <RoleGate allow={["admin", "accountant"]}>
                <ModuleGate module="accounting">
                  <TaxPage />
                </ModuleGate>
              </RoleGate>
            }
          />
          <Route
            path="reports"
            element={
              <RoleGate allow={["admin", "accountant"]}>
                <ModuleGate module="reports">
                  <ReportsPage />
                </ModuleGate>
              </RoleGate>
            }
          />

          {/* Admin + Staff */}
          <Route
            path="settings"
            element={
              <RoleGate allow={["super_admin", "admin", "installer", "accountant"]}>
                <Settings />
              </RoleGate>
            }
          />
          <Route
            path="supplier-ledger"
            element={
              <RoleGate allow={["admin", "accountant"]}>
                <ModuleGate module="suppliers">
                  <SupplierLedger />
                </ModuleGate>
              </RoleGate>
            }
          />

          <Route
            path="invoices"
            element={
              <RoleGate allow={["admin", "accountant"]}>

                <ModuleGate module="accounting">
                  <Invoices />
                </ModuleGate>
              </RoleGate>
            }
          />
          <Route
            path="invoices/new"
            element={
              <RoleGate allow={["admin", "accountant"]}>
                <ModuleGate module="accounting">
                  <InvoiceDetail />
                </ModuleGate>
              </RoleGate>
            }
          />
          <Route
            path="invoices/:id"
            element={
              <RoleGate allow={["admin", "accountant"]}>

                <ModuleGate module="accounting">
                  <InvoiceDetail />
                </ModuleGate>
              </RoleGate>
            }
          />


          <Route
            path="staff"
            element={
              <RoleGate allow={["admin"]}>
                <ModuleGate module="staff">
                  <StaffManagement />
                </ModuleGate>
              </RoleGate>
            }
          />

          <Route
            path="branches"
            element={
              <RoleGate allow={["admin", "super_admin"]}>
                <ModuleGate module="branches">
                  <BranchManagement />
                </ModuleGate>
              </RoleGate>
            }
          />

          <Route
            path="super-admin"
            element={
              <SuperAdminGuard>
                <RoleGate allow={["super_admin"]}>
                  <Navigate to="/super-admin/companies" replace />
                </RoleGate>
              </SuperAdminGuard>
            }
          />
          <Route
            path="super-admin/companies"
            element={
              <SuperAdminGuard>
                <RoleGate allow={["super_admin"]}>
                  <SuperAdminCompanies />
                </RoleGate>
              </SuperAdminGuard>
            }
          />
          <Route
            path="super-admin/trials"
            element={
              <SuperAdminGuard>
                <RoleGate allow={["super_admin"]}>
                  <SuperAdminTrials />
                </RoleGate>
              </SuperAdminGuard>
            }
          />
          <Route
            path="super-admin/support"
            element={
              <SuperAdminGuard>
                <RoleGate allow={["super_admin"]}>
                  <SuperAdminSupport />
                </RoleGate>
              </SuperAdminGuard>
            }
          />
          <Route
            path="super-admin/updates"
            element={
              <SuperAdminGuard>
                <RoleGate allow={["super_admin"]}>
                  <SuperAdminUpdates />
                </RoleGate>
              </SuperAdminGuard>
            }
          />
          <Route
            path="super-admin/notifications"
            element={
              <SuperAdminGuard>
                <RoleGate allow={["super_admin"]}>
                  <SuperAdminNotifications />
                </RoleGate>
              </SuperAdminGuard>
            }
          />
          <Route
            path="super-admin/mobile"
            element={
              <SuperAdminGuard>
                <RoleGate allow={["super_admin"]}>
                  <SuperAdminMobileManagement />
                </RoleGate>
              </SuperAdminGuard>
            }
          />
          <Route
            path="super-admin/mobile/versions"
            element={
              <SuperAdminGuard>
                <RoleGate allow={["super_admin"]}>
                  <SuperAdminMobileManagement section="versions" />
                </RoleGate>
              </SuperAdminGuard>
            }
          />
          <Route
            path="super-admin/mobile/publish"
            element={
              <SuperAdminGuard>
                <RoleGate allow={["super_admin"]}>
                  <SuperAdminMobileManagement section="publish" />
                </RoleGate>
              </SuperAdminGuard>
            }
          />
          <Route
            path="super-admin/mobile/forced"
            element={
              <SuperAdminGuard>
                <RoleGate allow={["super_admin"]}>
                  <SuperAdminMobileManagement section="forced" />
                </RoleGate>
              </SuperAdminGuard>
            }
          />
          <Route
            path="super-admin/mobile/company"
            element={
              <SuperAdminGuard>
                <RoleGate allow={["super_admin"]}>
                  <SuperAdminMobileManagement section="company" />
                </RoleGate>
              </SuperAdminGuard>
            }
          />
          <Route
            path="super-admin/mobile/devices"
            element={
              <SuperAdminGuard>
                <RoleGate allow={["super_admin"]}>
                  <SuperAdminMobileManagement section="devices" />
                </RoleGate>
              </SuperAdminGuard>
            }
          />
          <Route
            path="super-admin/mobile/push"
            element={
              <SuperAdminGuard>
                <RoleGate allow={["super_admin"]}>
                  <SuperAdminMobileManagement section="push" />
                </RoleGate>
              </SuperAdminGuard>
            }
          />



          {/* İç route bulunamazsa */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>

        {/* Dışarıda kalan her şey */}
        <Route path="*" element={<Navigate to="/login" replace />} />

          </Routes>
        </AuthProvider>
    </HashRouter>
    </ErrorBoundary>
  );
}

