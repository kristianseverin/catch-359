// Interactive route map (Leaflet) for the route section.
// Street map from CARTO/OpenStreetMap, satellite from Esri. The route line and the
// 360 start spots come from route-track.json, made by tools/build_route.py.

import { config } from './config.js';
import { degToKm, fmtKm } from './db.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Build the map inside `el`. Resolves to { setRiders(map<deg, rider>) } or null if
 * the map library couldn't load (for example offline).
 */
export async function initRouteMap(el) {
  const L = window.L;
  if (!L) {
    el.classList.add('is-unavailable');
    el.textContent = "The map couldn't load. Download the GPX files to see the route in your own map app.";
    return null;
  }

  let data;
  try {
    data = await fetch('route-track.json').then((r) => r.json());
  } catch {
    el.classList.add('is-unavailable');
    el.textContent = "The route couldn't load. Reload the page to try again.";
    return null;
  }

  const map = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.5 });
  el.leafletMap = map;   // handy for debugging in the browser console

  const streets = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  });
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  });
  streets.addTo(map);
  L.control.layers({ Map: streets, Satellite: satellite }, null, { position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);

  // Route: white casing under a red line, so it reads on both map and satellite
  L.polyline(data.track, { color: '#fff', weight: 7, opacity: 0.9, interactive: false }).addTo(map);
  const line = L.polyline(data.track, { color: css('--red') || '#C8102E', weight: 3.5, opacity: 1, interactive: false }).addTo(map);
  map.fitBounds(line.getBounds(), { padding: [16, 16] });

  // Start spots, drawn on a canvas so 360 markers stay fast
  map.createPane('spots').style.zIndex = 450;   // above the route line
  const renderer = L.canvas({ pane: 'spots', padding: 0.5, tolerance: 6 });
  const ink = css('--ink') || '#13222E';
  let riders = new Map();

  const popupHtml = (k) => {
    const [lat, lon] = data.spots[k];
    const r = riders.get(k);
    const who = r ? `<strong>${escapeHtml(r.rider_name)}</strong><br>${escapeHtml([r.country, r.club].filter(Boolean).join(', '))}<br>` : '';
    return `<div class="spot-popup"><span class="spot-popup-title">Spot ${k}</span>${who}km ${fmtKm(degToKm(k))} of ${config.routeKm}<br>` +
      `<a href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}" target="_blank" rel="noopener">Open in Google Maps</a></div>`;
  };

  const markers = data.spots.map(([lat, lon], k) => {
    const m = L.circleMarker([lat, lon], {
      renderer, radius: k === 0 ? 6 : 3.5, weight: 1.5,
      color: ink, fillColor: k === 0 ? ink : '#fff', fillOpacity: 1,
    });
    m.bindTooltip(() => {
      const r = riders.get(k);
      return `Spot ${k}${r ? `: ${escapeHtml(r.rider_name)}` : ''}`;
    }, { direction: 'top', offset: [0, -4] });
    m.bindPopup(() => popupHtml(k));
    return m.addTo(map);
  });

  // Small spots at low zoom, bigger when zoomed in
  const sizeSpots = () => {
    const z = map.getZoom();
    const r = z < 8.5 ? 2.5 : z < 10 ? 3.5 : 5;
    markers.forEach((m, k) => m.setRadius(k === 0 ? r + 2.5 : r));
  };
  map.on('zoomend', sizeSpots);
  sizeSpots();

  // Don't hijack page scrolling: wheel-zoom only after the map is clicked
  map.on('click focus', () => map.scrollWheelZoom.enable());
  map.on('mouseout blur', () => map.scrollWheelZoom.disable());

  return {
    setRiders(byDeg) {
      riders = byDeg;
      const red = css('--red') || '#C8102E';
      markers.forEach((m, k) => {
        if (k !== 0) m.setStyle({ fillColor: byDeg.has(k) ? red : '#fff' });
      });
    },
    focusSpot(k) {
      map.flyTo(data.spots[k], Math.max(map.getZoom(), 12), { duration: 0.8 });
      markers[k].openPopup();
    },
  };
}
