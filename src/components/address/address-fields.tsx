"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import type { AddressSuggestion, AddressValue } from "@/lib/address";
import { addressDetails, suggestAddresses } from "@/server/address/actions";

type Errors = Partial<Record<keyof AddressValue, string | undefined>>;

const newSession = () => crypto.randomUUID();

/**
 * Street, line 2, city, state and ZIP. With lookup on, typing in the street
 * box suggests real US addresses; picking one fills in the rest. Every
 * field stays editable, and without lookup they're plain inputs.
 */
export function AddressFields({
  value,
  onChange,
  errors = {},
  lookup,
  streetLabel = "Street address",
}: {
  value: AddressValue;
  onChange: (patch: Partial<AddressValue>) => void;
  errors?: Errors;
  lookup: boolean;
  streetLabel?: string;
}) {
  const listId = useId();
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [query, setQuery] = useState<string | null>(null);
  const session = useRef<string>("");
  const latest = useRef(0);

  // Ask for suggestions 250 ms after typing stops.
  useEffect(() => {
    if (!lookup || query === null || query.trim().length < 3) return;
    const t = setTimeout(async () => {
      if (!session.current) session.current = newSession();
      const ticket = ++latest.current;
      const r = await suggestAddresses({ query, session: session.current });
      if (ticket !== latest.current) return; // a newer search is on its way
      setItems(r);
      setActive(-1);
      setOpen(r.length > 0);
    }, 250);
    return () => clearTimeout(t);
  }, [query, lookup]);

  async function pick(s: AddressSuggestion) {
    setOpen(false);
    setItems([]);
    setQuery(null);
    onChange({ addressLine1: s.main });
    const details = await addressDetails({ placeId: s.placeId, session: session.current || newSession() });
    session.current = ""; // the pick ends Google's session
    if (details) onChange(details);
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
      <div className="relative md:col-span-4">
        <Input
          label={streetLabel}
          value={value.addressLine1}
          maxLength={200}
          autoComplete="off"
          error={errors.addressLine1}
          hint={lookup ? "Start typing to look up the address" : undefined}
          {...(lookup && {
            role: "combobox",
            "aria-autocomplete": "list",
            "aria-expanded": open,
            "aria-controls": listId,
            "aria-activedescendant": active >= 0 ? `${listId}-${active}` : undefined,
          })}
          onChange={(e) => {
            onChange({ addressLine1: e.target.value });
            setQuery(e.target.value);
            if (e.target.value.trim().length < 3) {
              setItems([]);
              setOpen(false);
            }
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!open || items.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (i + 1) % items.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
            } else if (e.key === "Enter" && active >= 0) {
              e.preventDefault();
              void pick(items[active]);
            } else if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
        {lookup && open && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Address suggestions"
            className="absolute top-[64px] right-0 left-0 z-20 m-0 list-none rounded-sm border border-line bg-surface p-1 shadow-md"
          >
            {items.map((s, i) => (
              <li
                key={s.placeId}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in the box
                  void pick(s);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn("cursor-pointer rounded-sm px-2.5 py-1.5 text-sm", i === active && "bg-surface-2")}
              >
                <span className="font-medium">{s.main}</span>
                {s.secondary && <span className="text-muted"> · {s.secondary}</span>}
              </li>
            ))}
            <li aria-hidden="true" className="px-2.5 pt-1 text-right text-2xs text-faint">
              Powered by Google
            </li>
          </ul>
        )}
      </div>
      <Input
        label="Suite / unit"
        value={value.addressLine2}
        maxLength={200}
        error={errors.addressLine2}
        wrapperClassName="md:col-span-2"
        onChange={(e) => onChange({ addressLine2: e.target.value })}
      />
      <Input
        label="City"
        value={value.city}
        maxLength={100}
        error={errors.city}
        wrapperClassName="md:col-span-3"
        onChange={(e) => onChange({ city: e.target.value })}
      />
      <Input
        label="State"
        value={value.state}
        maxLength={2}
        error={errors.state}
        wrapperClassName="md:col-span-1"
        onChange={(e) => onChange({ state: e.target.value })}
      />
      <Input
        label="ZIP"
        value={value.postalCode}
        maxLength={10}
        inputMode="numeric"
        error={errors.postalCode}
        wrapperClassName="md:col-span-2"
        onChange={(e) => onChange({ postalCode: e.target.value })}
      />
    </div>
  );
}
