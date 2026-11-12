import { useRef } from 'react';
import { useRerender } from '../useRerender/index.js';
const proto = Map.prototype;
/**
 * Tracks the state of a `Map`.
 *
 * @param entries Initial entries iterator for underlying `Map` constructor.
 */
export function useMap(entries) {
    const mapRef = useRef(undefined);
    const rerender = useRerender();
    if (!mapRef.current) {
        const map = new Map(entries);
        mapRef.current = map;
        map.set = (...args) => {
            proto.set.apply(map, args);
            rerender();
            return map;
        };
        map.clear = (...args) => {
            proto.clear.apply(map, args);
            rerender();
        };
        map.delete = (...args) => {
            const existed = proto.delete.apply(map, args);
            rerender();
            return existed;
        };
    }
    return mapRef.current;
}
