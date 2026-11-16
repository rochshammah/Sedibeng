import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import {
  getGetMyServiceAreaQueryKey, useGetLocations, useGetMyServiceArea, useSetMyServiceArea,
} from '@workspace/api-client-react';

export const goodsCategories = ['School shoes', 'School uniforms', 'Books and stationery', 'School bags', 'Learning materials', 'Other school essentials'];
export const goodsConditionLabels: Record<string, string> = { NEW: 'New', GOOD: 'Good', FAIR: 'Fair' };
export const groupLabels: Record<string, string> = {
  SHOES: 'Shoes', UNIFORMS: 'Uniforms', BAGS: 'Bags', BOOKS_STATIONERY: 'Books & stationery', LEARNING_MATERIALS: 'Learning materials', OTHER: 'Other',
};

// Location choices, grouped under their service area. Always selected by id, never typed.
export function LocationSelect({ value, onChange, placeholder = 'Choose a location', testId, required }: {
  value: string; onChange: (value: string) => void; placeholder?: string; testId?: string; required?: boolean;
}) {
  const locations = useGetLocations();
  return (
    <select className="ws-input" value={value} onChange={(e) => onChange(e.target.value)} required={required} data-testid={testId} aria-label="Location">
      <option value="">{placeholder}</option>
      {(locations.data ?? []).map((area) => (
        <optgroup key={area.id} label={area.name}>
          {area.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

export const ALL_AREAS = 'all';

// Which service area a list is showing. It starts at the person's own area (a default,
// not a restriction) and they can switch to any other area, or to all areas, at any time.
export function useServiceAreaFilter() {
  const client = useQueryClient();
  const mine = useGetMyServiceArea();
  const areas = useGetLocations();
  const save = useSetMyServiceArea();
  const [picked, setPicked] = useState<string | null>(null);
  const ready = !mine.isLoading;
  const value = picked ?? mine.data?.serviceAreaId ?? ALL_AREAS;
  return {
    ready,
    value,
    /** Undefined means "all areas". */
    serviceAreaId: value === ALL_AREAS ? undefined : value,
    areas: areas.data ?? [],
    myAreaName: mine.data?.serviceAreaName ?? null,
    select: (next: string) => {
      setPicked(next);
      save.mutate({ data: { serviceAreaId: next === ALL_AREAS ? null : next } }, { onSuccess: () => void client.invalidateQueries({ queryKey: getGetMyServiceAreaQueryKey() }) });
    },
  };
}

export function AreaPicker({ filter, label }: { filter: ReturnType<typeof useServiceAreaFilter>; label: string }) {
  return (
    <label className="ws-areapicker">
      <MapPin size={15} /><span>{label}</span>
      <select value={filter.value} onChange={(e) => filter.select(e.target.value)} aria-label={label} data-testid="select-service-area">
        {filter.areas.map((area) => <option key={area.id} value={area.id}>{area.name}{area.id === filter.value ? '' : ''}</option>)}
        <option value={ALL_AREAS}>All areas</option>
      </select>
    </label>
  );
}

// Item photos are served privately by the API. Only approved photos (or your own) ever load.
export function GoodsPhoto({ id, version, className = '', alt }: { id: string; version: string; className?: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img className={`ws-goods-photo ${className}`} src={`${import.meta.env.BASE_URL}api/v1/inventory/${id}/photo?v=${version}`} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}
