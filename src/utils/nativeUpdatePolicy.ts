export type NativeUpdatePolicy = {
    platform: string;
    minimum_version: string;
    store_url: string;
    enabled: boolean;
};

function versionParts(value: string): number[] | null {
    if (!/^\d+\.\d+\.\d+$/.test(value)) return null;
    return value.split(".").map(Number);
}

export function requiresNativeUpdate(policy: NativeUpdatePolicy | null, platform: string, current: string): boolean {
    if (!policy?.enabled || platform !== "ios" || policy.platform !== platform) return false;
    const minimum = versionParts(policy.minimum_version);
    const installed = versionParts(current);
    if (!minimum || !installed) return false;
    // Never block access for a missing or non-App-Store destination.
    try {
        const url = new URL(policy.store_url);
        if (url.protocol !== "https:" || url.hostname !== "apps.apple.com" || !/\/id\d+(?:\/|$)/.test(url.pathname)) return false;
    } catch { return false; }
    for (let i = 0; i < 3; i++) {
        if (installed[i] !== minimum[i]) return installed[i] < minimum[i];
    }
    return false;
}
