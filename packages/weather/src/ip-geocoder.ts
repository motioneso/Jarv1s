interface IpWhoIsResponse {
  success: boolean;
  latitude: number;
  longitude: number;
  city: string;
  country: string;
}

interface GeoLocation {
  lat: number;
  lon: number;
  label: string;
}

export async function geocodeIp(
  ip: string,
  fetchFn: typeof fetch = fetch
): Promise<GeoLocation | null> {
  // Strip IPv6 brackets and skip loopback/private addresses
  const cleaned = ip.replace(/^\[/, "").replace(/\]$/, "");
  if (
    cleaned === "::1" ||
    cleaned === "127.0.0.1" ||
    cleaned.startsWith("10.") ||
    cleaned.startsWith("192.168.") ||
    cleaned.startsWith("172.")
  ) {
    return null;
  }

  try {
    const response = await fetchFn(`https://ipwho.is/${encodeURIComponent(cleaned)}`);
    if (!response.ok) return null;
    const data = (await response.json()) as IpWhoIsResponse;
    if (!data.success) return null;
    const label = [data.city, data.country].filter(Boolean).join(", ") || "Unknown";
    return { lat: data.latitude, lon: data.longitude, label };
  } catch {
    return null;
  }
}
