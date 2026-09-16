import React, { lazy, Suspense, useEffect } from "react";
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { App as CapacitorApp } from "@capacitor/app";
import { Layout } from "./layouts/Layout";
import { RoleProvider, useRole } from "./context/RoleContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { SupportModalProvider } from "./context/SupportModalContext";
import { ImpersonationProvider } from "./context/ImpersonationContext";
import TenantGuard from "./components/TenantGuard";
import SuperAdminGuard from "./components/SuperAdminGuard";
import ModuleGate from "./components/ModuleGate";
import SignupWithCode from "./pages/SignupWithCode";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import Unauthorized from "./pages/Unauthorized";
import Locked from "./pages/Locked";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { canAccess, type AppRole } from "./auth/roles";
import { initLocalNotificationNavigation } from "./utils/localNotifications";
import { isNativeAndroid } from "./utils/nativeRuntime";

// ---------------------------------------------------------------------------
// Rota bazli kod bolme (code-splitting): her sayfa ayri bir parcaya cikar ve
// yalnizca o rotaya girildiginde indirilir. Mobilde ilk acilis suresini ve
// veri kullanimini ciddi olcude dusurur.
// ---------------------------------------------------------------------------
const Accounting = lazy(() => import("./pages/Accounting").then((m) => ({ default: m.Accounting })));
const AppointmentDetail = lazy(() => import("./pages/AppointmentDetail"));
const BranchManagement = lazy(() => import("./pages/BranchManagement"));
const CatalogManagement = lazy(() => import("./pages/CatalogManagement"));
const Collections = lazy(() => import("./pages/Collections"));
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Customers = lazy(() => import("./pages/Customers"));
const DeploymentHistory = lazy(() => import("./pages/DeploymentHistory"));
const DeploymentWizard = lazy(() => import("./pages/DeploymentWizard"));
const ExpensesPage = lazy(() => import("./pages/AccountingSubPages").then((m) => ({ default: m.ExpensesPage })));
const FieldCustomers = lazy(() => import("./pages/FieldCustomers"));
const FieldDashboard = lazy(() => import("./pages/FieldDashboard"));
const IncomePage = lazy(() => import("./pages/AccountingSubPages").then((m) => ({ default: m.IncomePage })));
const InstallationTracking = lazy(() => import("./pages/InstallationTracking"));
const Installations = lazy(() => import("./pages/Installations"));
const InstallerEarningsDetail = lazy(() => import("./pages/InstallerEarningsDetail"));
const InvoiceDetail = lazy(() => import("./pages/InvoiceDetail"));
const Invoices = lazy(() => import("./pages/Invoices"));
const MeasurementEntry = lazy(() => import("./pages/MeasurementEntry"));
const NewAppointment = lazy(() => import("./pages/NewAppointment"));
const NewOrder = lazy(() => import("./pages/NewOrder"));
const NewSupplier = lazy(() => import("./pages/NewSupplier"));
const OrderDetail = lazy(() => import("./pages/OrderDetail"));
const Orders = lazy(() => import("./pages/Orders"));
const Products = lazy(() => import("./pages/Products"));
const Quotes = lazy(() => import("./pages/Quotes"));
const ReportsPage = lazy(() => import("./pages/AccountingSubPages").then((m) => ({ default: m.ReportsPage })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const StaffManagement = lazy(() => import("./pages/StaffManagement"));
const SuperAdminBackupCenter = lazy(() => import("./pages/SuperAdminBackupCenter"));
const SuperAdminCompanies = lazy(() => import("./pages/SuperAdminCompanies"));
const SuperAdminDatabaseHealth = lazy(() => import("./pages/SuperAdminDatabaseHealth"));
const SuperAdminErrorLogs = lazy(() => import("./pages/SuperAdminErrorLogs"));
const SuperAdminFirmaDetay = lazy(() => import("./pages/SuperAdminFirmaDetay"));
const SuperAdminLicenseManagement = lazy(() => import("./pages/SuperAdminLicenseManagement"));
const SuperAdminLiveMonitoring = lazy(() => import("./pages/SuperAdminLiveMonitoring"));
const SuperAdminMobileManagement = lazy(() => import("./pages/SuperAdminMobileManagement"));
const SuperAdminNotifications = lazy(() => import("./pages/SuperAdminNotifications"));
const SuperAdminObservability = lazy(() => import("./pages/SuperAdminObservability"));
const SuperAdminRemoteMaintenance = lazy(() => import("./pages/SuperAdminRemoteMaintenance"));
const SuperAdminSupport = lazy(() => import("./pages/SuperAdminSupport"));
const SuperAdminTrials = lazy(() => import("./pages/SuperAdminTrials"));
const SuperAdminUpdates = lazy(() => import("./pages/SuperAdminUpdates"));
const SuperAdminVersioning = lazy(() => import("./pages/SuperAdminVersioning"));
const SupplierCariReport = lazy(() => import("./pages/SupplierCariReport"));
const SupplierDetail = lazy(() => import("./pages/SupplierDetail"));
const SupplierLedger = lazy(() => import("./pages/SupplierLedger"));
const Suppliers = lazy(() => import("./pages/Suppliers").then((m) => ({ default: m.Suppliers })));
const TaxPage = lazy(() => import("./pages/AccountingSubPages").then((m) => ({ default: m.TaxPage })));
const TodayRoute = lazy(() => import("./pages/TodayRoute"));
const VisualPreviews = lazy(() => import("./pages/VisualPreviews"));


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
  const { status, role, isPasswordRecovery } = useAuth();

  if (status === "loading") return <div style={{ padding: 16 }}>Yönlendirme hazırlanıyor...</div>;
  if (isPasswordRecovery) return <Navigate to="/reset-password" replace />;
  if (status === "unauthenticated") return <Navigate to="/login" replace />;
  if (status === "unauthorized") return <Navigate to="/unauthorized" replace />;
  if (status === "locked") return <Navigate to="/locked" replace />;

  return <Navigate to={defaultPathForRole(role)} replace />;
}

function AndroidBackButtonHandler() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isNativeAndroid()) return;
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

function LocalNotificationNavigationHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    return initLocalNotificationNavigation((url) => {
      navigate(url);
    });
  }, [navigate]);

  return null;
}

function PasswordRecoveryRedirect() {
  const { isPasswordRecovery } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (isPasswordRecovery && location.pathname !== "/reset-password") {
      navigate("/reset-password", { replace: true });
    }
  }, [isPasswordRecovery, location.pathname, navigate]);

  return null;
}

/** Rota parcasi indirilirken gosterilen hafif yukleniyor ekrani. */
function RouteFallback() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-8">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-sky-500" />
        <span className="text-sm font-medium text-slate-500">Yükleniyor…</span>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <AuthProvider>
          <ImpersonationProvider>
            <SupportModalProvider>
              <AndroidBackButtonHandler />
              <LocalNotificationNavigationHandler />
              <PasswordRecoveryRedirect />
                <Suspense fallback={<RouteFallback />}>
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
                path="quotes"
                element={
                  <RoleGate allow={["admin", "installer", "accountant"]}>
                    <ModuleGate module="orders">
                      <Quotes />
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
                      <InstallationTracking />
                    </ModuleGate>
                  </RoleGate>
                }
              />
                <Route
                path="installer/:installerId/earnings"
                element={
                  <RoleGate allow={["admin", "installer"]}>
                    <ModuleGate module="installation">
                      <InstallerEarningsDetail />
                    </ModuleGate>
                  </RoleGate>
                }
              />
                <Route
                path="route/appointments"
                element={
                  <RoleGate allow={["admin", "installer"]}>
                    <TodayRoute />
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
                    <ModuleGate module="catalogs">
                      <CatalogManagement />
                    </ModuleGate>
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
                path="installations"
                element={
                  <RoleGate allow={["admin", "accountant", "installer"]}>
                    <ModuleGate module="installation">
                      <Installations />
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
                path="suppliers/:id"
                element={
                  <RoleGate allow={["admin", "accountant"]}>
                    <ModuleGate module="suppliers">
                      <SupplierDetail />
                    </ModuleGate>
                  </RoleGate>
                }
              />
                <Route
                path="suppliers/cari-rapor"
                element={
                  <RoleGate allow={["admin", "accountant"]}>
                    <ModuleGate module="suppliers">
                      <SupplierCariReport />
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
                path="collections"
                element={
                  <RoleGate allow={["admin", "accountant"]}>
                    <ModuleGate module="collections">
                      <Collections />
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
                path="super-admin/observability"
                element={
                  <SuperAdminGuard>
                    <RoleGate allow={["super_admin"]}>
                      <SuperAdminObservability />
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

                {/* New Super Admin Pages */}
                <Route
                path="super-admin/companies/:companyId"
                element={
                  <SuperAdminGuard>
                    <RoleGate allow={["super_admin"]}>
                      <SuperAdminFirmaDetay />
                    </RoleGate>
                  </SuperAdminGuard>
                }
              />
                <Route
                path="super-admin/live-monitoring"
                element={
                  <SuperAdminGuard>
                    <RoleGate allow={["super_admin"]}>
                      <SuperAdminLiveMonitoring />
                    </RoleGate>
                  </SuperAdminGuard>
                }
              />
                <Route
                path="super-admin/remote-maintenance"
                element={
                  <SuperAdminGuard>
                    <RoleGate allow={["super_admin"]}>
                      <SuperAdminRemoteMaintenance />
                    </RoleGate>
                  </SuperAdminGuard>
                }
              />
                <Route
                path="super-admin/error-logs"
                element={
                  <SuperAdminGuard>
                    <RoleGate allow={["super_admin"]}>
                      <SuperAdminErrorLogs />
                    </RoleGate>
                  </SuperAdminGuard>
                }
              />
                <Route
                path="super-admin/versioning"
                element={
                  <SuperAdminGuard>
                    <RoleGate allow={["super_admin"]}>
                      <SuperAdminVersioning />
                    </RoleGate>
                  </SuperAdminGuard>
                }
              />
                <Route
                path="super-admin/deployment/wizard"
                element={
                  <SuperAdminGuard>
                    <RoleGate allow={["super_admin"]}>
                      <DeploymentWizard />
                    </RoleGate>
                  </SuperAdminGuard>
                }
              />
                <Route
                path="super-admin/deployment/history"
                element={
                  <SuperAdminGuard>
                    <RoleGate allow={["super_admin"]}>
                      <DeploymentHistory />
                    </RoleGate>
                  </SuperAdminGuard>
                }
              />
                <Route
                path="super-admin/license-management"
                element={
                  <SuperAdminGuard>
                    <RoleGate allow={["super_admin"]}>
                      <SuperAdminLicenseManagement />
                    </RoleGate>
                  </SuperAdminGuard>
                }
              />
                <Route
                path="super-admin/backup-center"
                element={
                  <SuperAdminGuard>
                    <RoleGate allow={["super_admin"]}>
                      <SuperAdminBackupCenter />
                    </RoleGate>
                  </SuperAdminGuard>
                }
              />
                <Route
                path="super-admin/database-health"
                element={
                  <SuperAdminGuard>
                    <RoleGate allow={["super_admin"]}>
                      <SuperAdminDatabaseHealth />
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
                </Suspense>
            </SupportModalProvider>
          </ImpersonationProvider>
        </AuthProvider>
      </HashRouter>
    </ErrorBoundary>
  );
}

