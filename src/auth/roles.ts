export type AppRole = "super_admin" | "admin" | "accountant" | "installer" | "measurement" | "personnel";
export type RoleState = AppRole | "unknown";

const ROLE_ALIASES: Record<string, AppRole> = {
  super_admin: "super_admin",
  superadmin: "super_admin",
  super: "super_admin",
  "super yonetici": "super_admin",
  admin: "admin",
  manager: "admin",
  yonetici: "admin",
  yönetici: "admin",
  accountant: "accountant",
  accounting: "accountant",
  muhasebe: "accountant",
  muhasebeci: "accountant",
  installer: "installer",
  staff: "installer",
  saha: "installer",
  "saha personeli": "installer",
  montaj: "installer",
  montajci: "installer",
  montajcı: "installer",
  measurement: "measurement",
  olcu: "measurement",
  ölçü: "measurement",
  "ölçü personeli": "measurement",
  personnel: "personnel",
  personel: "personnel",
};

function toRoleKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/\u0131/g, "i")
    .replace(/\u015f/g, "s")
    .replace(/\u011f/g, "g")
    .replace(/\u00fc/g, "u")
    .replace(/\u00f6/g, "o")
    .replace(/\u00e7/g, "c")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeRole(value: unknown): RoleState {
  return ROLE_ALIASES[toRoleKey(value)] ?? "unknown";
}

export function isKnownRole(role: RoleState): role is AppRole {
  return role !== "unknown";
}

export function canAccess(role: RoleState, allow: readonly AppRole[]) {
  return isKnownRole(role) && allow.includes(role);
}

export function roleLabel(role: RoleState) {
  if (role === "super_admin") return "Süper Yönetici";
  if (role === "admin") return "Yönetici";
  if (role === "accountant") return "Muhasebe";
  if (role === "installer") return "Saha Personeli";
  if (role === "measurement" || role === "personnel") return "Saha Personeli";
  return "Bilinmiyor";
}

export function canUseManagement(role: RoleState) {
  return canAccess(role, ["admin", "accountant"]);
}

export function canUseFieldWork(role: RoleState) {
  return canAccess(role, ["admin", "installer"]);
}

export function canUseAccounting(role: RoleState) {
  return canAccess(role, ["admin", "accountant"]);
}
