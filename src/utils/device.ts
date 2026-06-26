import { sha256 } from "js-sha256";

export function getDeviceId() {
  let rawDeviceId = localStorage.getItem("app_device_id");
  if (!rawDeviceId) {
    rawDeviceId = "dev-" + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    localStorage.setItem("app_device_id", rawDeviceId);
  }
  return sha256(rawDeviceId);
}
