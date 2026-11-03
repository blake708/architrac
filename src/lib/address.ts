// Turning a looked-up address into our address fields (projects and
// companies use the same five columns). Pure, so it's unit tested.

export type AddressValue = {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
};

export const EMPTY_ADDRESS: AddressValue = {
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
};

/** One part of a Google Places address ("addressComponents"). */
export type AddressComponent = { longText: string; shortText: string; types: string[] };

/** A suggestion shown under the address box. */
export type AddressSuggestion = { placeId: string; main: string; secondary: string };

/**
 * Google's address parts → our fields. Line 2 keeps whatever the person
 * typed unless the place has a unit ("Suite 200").
 */
export function addressFromComponents(parts: readonly AddressComponent[]): Partial<AddressValue> {
  const get = (type: string, short = false) => {
    const p = parts.find((x) => x.types.includes(type));
    return p ? (short ? p.shortText : p.longText) : "";
  };
  const street = [get("street_number"), get("route", true)].filter(Boolean).join(" ");
  const line1 = street || get("premise") || get("establishment");
  const city = get("locality") || get("postal_town") || get("sublocality") || get("administrative_area_level_3");
  const zip = get("postal_code");
  const suffix = get("postal_code_suffix");
  const unit = get("subpremise");

  const out: Partial<AddressValue> = {
    addressLine1: line1,
    city,
    state: get("administrative_area_level_1", true).toUpperCase().slice(0, 2),
    postalCode: zip && suffix ? `${zip}-${suffix}` : zip,
  };
  if (unit) out.addressLine2 = /^\d/.test(unit) ? `Suite ${unit}` : unit;
  return out;
}

/** Google's reply to an autocomplete call → our suggestion list. */
export function suggestionsFrom(body: unknown): AddressSuggestion[] {
  const list = (body as { suggestions?: unknown[] })?.suggestions ?? [];
  const out: AddressSuggestion[] = [];
  for (const s of list) {
    const p = (s as {
      placePrediction?: {
        placeId?: string;
        text?: { text?: string };
        structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
      };
    }).placePrediction;
    if (!p?.placeId) continue;
    out.push({
      placeId: p.placeId,
      main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
      secondary: p.structuredFormat?.secondaryText?.text ?? "",
    });
  }
  return out.slice(0, 5);
}
