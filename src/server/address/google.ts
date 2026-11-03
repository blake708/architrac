import { z } from "zod";
import {
  type AddressComponent,
  type AddressSuggestion,
  type AddressValue,
  addressFromComponents,
  suggestionsFrom,
} from "@/lib/address";

// Address lookup through Google Places (New). Server only: the API key never
// reaches the browser. Without GOOGLE_MAPS_API_KEY the lookup is off and the
// address fields are plain inputs.

const BASE = "https://places.googleapis.com/v1";

export const lookupEnabled = () => Boolean(process.env.GOOGLE_MAPS_API_KEY);

export const suggestInput = z.object({
  query: z.string().trim().min(3).max(200),
  /** Groups the typing and the pick into one billed Google "session". */
  session: z.uuid(),
});
export const detailsInput = z.object({
  placeId: z.string().regex(/^[A-Za-z0-9_-]{1,300}$/),
  session: z.uuid(),
});

type Fetch = typeof fetch;

export async function suggestCore(
  raw: unknown,
  key = process.env.GOOGLE_MAPS_API_KEY,
  fetchFn: Fetch = fetch,
): Promise<AddressSuggestion[]> {
  const input = suggestInput.safeParse(raw);
  if (!key || !input.success) return [];
  try {
    const res = await fetchFn(`${BASE}/places:autocomplete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
      body: JSON.stringify({
        input: input.data.query,
        sessionToken: input.data.session,
        includedRegionCodes: ["us"],
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error("Address suggestions failed", res.status);
      return [];
    }
    return suggestionsFrom(await res.json());
  } catch (err) {
    console.error("Address suggestions failed", err);
    return [];
  }
}

export async function detailsCore(
  raw: unknown,
  key = process.env.GOOGLE_MAPS_API_KEY,
  fetchFn: Fetch = fetch,
): Promise<Partial<AddressValue> | null> {
  const input = detailsInput.safeParse(raw);
  if (!key || !input.success) return null;
  try {
    const url = `${BASE}/places/${encodeURIComponent(input.data.placeId)}?sessionToken=${input.data.session}`;
    const res = await fetchFn(url, {
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "addressComponents" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error("Address details failed", res.status);
      return null;
    }
    const body = (await res.json()) as { addressComponents?: AddressComponent[] };
    return addressFromComponents(body.addressComponents ?? []);
  } catch (err) {
    console.error("Address details failed", err);
    return null;
  }
}
