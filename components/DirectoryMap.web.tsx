import React, { useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';

export interface MapMarkerData {
  id: string;
  latitude: number;
  longitude: number;
  name: string;
  role: string;
  roleKey: string;
  city?: string;
  skills?: string[];
  color: string;
  avatar?: string;
  isOnline: boolean;
  lastSeen?: number;
}

interface DirectoryMapProps {
  markers: MapMarkerData[];
  onMarkerPress?: (id: string) => void;
  onChatPress?: (id: string) => void;
}

function getMapHTML() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', sans-serif; overflow: hidden; }
  #map { width: 100%; height: 100vh; }

  .leaflet-control-zoom { border: none !important; box-shadow: 0 2px 12px rgba(0,0,0,0.1) !important; border-radius: 12px !important; overflow: hidden; }
  .leaflet-control-zoom a {
    background: rgba(255,255,255,0.95) !important; color: #333 !important; border: none !important;
    width: 36px !important; height: 36px !important; line-height: 36px !important; font-size: 18px !important;
    border-bottom: 1px solid rgba(0,0,0,0.06) !important;
  }
  .leaflet-control-zoom a:last-child { border-bottom: none !important; }
  .leaflet-control-attribution { display: none !important; }
  .leaflet-popup-content-wrapper { border-radius: 0 !important; background: transparent !important; box-shadow: none !important; }
  .leaflet-popup-content { margin: 0 !important; }
  .leaflet-popup-tip-container { display: none !important; }

  .avatar-marker {
    width: 44px; height: 44px; border-radius: 50%; border: 3px solid;
    background-size: cover; background-position: center; background-color: #ddd;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    cursor: pointer; position: relative;
    transition: transform 0.2s ease, opacity 0.2s ease;
  }
  .avatar-marker.online::after {
    content: ''; position: absolute; bottom: -2px; right: -2px;
    width: 12px; height: 12px; border-radius: 50%;
    background: #00E676; border: 2px solid #fff;
  }
  .avatar-marker .initials {
    width: 100%; height: 100%; display: flex; align-items: center;
    justify-content: center; color: white; font-weight: 800;
    font-size: 14px; border-radius: 50%;
  }

  .dot-marker {
    width: 14px; height: 14px; border-radius: 50%; border: 2px solid #fff;
    box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    cursor: pointer; position: relative;
  }
  .dot-marker.online::after {
    content: ''; position: absolute; bottom: -1px; right: -1px;
    width: 6px; height: 6px; border-radius: 50%;
    background: #00E676; border: 1px solid #fff;
  }

  .my-location-btn {
    position: fixed; bottom: 80px; right: 16px; z-index: 900;
    width: 44px; height: 44px; border-radius: 50%;
    background: rgba(255,255,255,0.95);
    border: 1px solid rgba(0,0,0,0.08);
    box-shadow: 0 2px 12px rgba(0,0,0,0.12);
    cursor: pointer; display: flex; align-items: center; justify-content: center;
  }
  .my-location-btn svg { width: 20px; height: 20px; }

  .user-card {
    position: fixed; bottom: 60px; left: 12px; right: 12px;
    max-width: 400px; margin: 0 auto;
    background: rgba(255,255,255,0.97); backdrop-filter: blur(20px);
    border-radius: 20px; padding: 14px 16px; display: none;
    box-shadow: 0 4px 24px rgba(0,0,0,0.15);
    border: 1px solid rgba(0,0,0,0.08);
    z-index: 9999;
  }
  .user-card.show { display: flex; flex-direction: row; align-items: center; gap: 12px; }

  .card-avatar {
    width: 48px; height: 48px; border-radius: 50%; border: 3px solid;
    background-size: cover; background-position: center; background-color: #e8e8e8;
    flex-shrink: 0;
  }
  .card-avatar .initials {
    width: 100%; height: 100%; display: flex; align-items: center;
    justify-content: center; color: white; font-weight: 800;
    font-size: 18px; border-radius: 50%;
  }
  .card-info { flex: 1; min-width: 0; }
  .card-name { color: #1a1a2e; font-size: 15px; font-weight: 700; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-role { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; display: inline-block; padding: 2px 6px; border-radius: 4px; }
  .card-meta { color: #888; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-online-badge { display: inline-flex; align-items: center; gap: 3px; color: #00c853; font-weight: 600; }
  .card-online-badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #00E676; }

  .card-actions { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
  .card-btn { border: none; border-radius: 12px; padding: 10px 16px; font-size: 13px; font-weight: 700; cursor: pointer; min-height: 38px; touch-action: manipulation; -webkit-tap-highlight-color: rgba(0,0,0,0.1); }
  .btn-chat { background: #FF2D55; color: #fff; }
  .btn-profile { background: rgba(0,0,0,0.08); color: #333; }
  .btn-close { position: absolute; top: 10px; right: 12px; background: rgba(0,0,0,0.06); border: none; color: #999; font-size: 16px; cursor: pointer; padding: 2px 7px; border-radius: 10px; line-height: 1; }
</style>
</head>
<body>
<div class="my-location-btn" onclick="requestMyLocation()">
  <svg viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
    <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
  </svg>
</div>
<div id="map"></div>
<div class="user-card" id="userCard">
  <button class="btn-close" onclick="closeCard()">&times;</button>
  <div class="card-avatar" id="cardAvatar"><div class="initials" id="cardInitials"></div></div>
  <div class="card-info">
    <div class="card-name" id="cardName"></div>
    <div class="card-role" id="cardRole"></div>
    <div class="card-meta" id="cardMeta"></div>
  </div>
  <div class="card-actions">
    <button class="card-btn btn-profile" onclick="viewProfile()">Profile</button>
    <button class="card-btn btn-chat" onclick="chatUser()">Chat</button>
  </div>
</div>
<script>
  var map = L.map('map', { zoomControl: false, attributionControl: false }).setView([20.5937, 78.9629], 5);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd', maxZoom: 19
  }).addTo(map);

  var markerLayer = L.layerGroup().addTo(map);
  var selectedId = null;
  var currentMarkers = [];
  var ZOOM_THRESHOLD = 8;
  var gradients = [
    ['#FF6B6B','#EE5A24'],['#A29BFE','#6C5CE7'],['#55E6C1','#1ABC9C'],
    ['#FFEAA7','#FDCB6E'],['#74B9FF','#0984E3'],['#FD79A8','#E84393'],
    ['#E17055','#D63031'],['#00CEC9','#00B894'],['#FAB1A0','#E17055']
  ];

  function getGradient(name) {
    var hash = 0;
    for (var i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    var idx = Math.abs(hash) % gradients.length;
    return 'linear-gradient(135deg, ' + gradients[idx][0] + ', ' + gradients[idx][1] + ')';
  }
  function getInitials(name) {
    return name.split(' ').map(function(w) { return w[0]; }).join('').substring(0,2).toUpperCase();
  }
  function getTimeAgo(ts) {
    if (!ts) return 'Not seen';
    var diff = Date.now() - ts;
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
  }
  function closeCard() {
    document.getElementById('userCard').classList.remove('show');
    selectedId = null;
  }
  function sendToParent(msg) {
    try { window.parent.postMessage(msg, '*'); } catch(e) {}
    try { if (window.top !== window) window.top.postMessage(msg, '*'); } catch(e) {}
  }
  function viewProfile() { if (selectedId) sendToParent({ type: 'viewProfile', id: selectedId }); }
  function chatUser() { if (selectedId) sendToParent({ type: 'chatUser', id: selectedId }); }
  function requestMyLocation() { sendToParent({ type: 'requestMyLocation' }); }

  function createMarkerIcon(m, zoomedIn) {
    var hasAvatar = m.avatar && m.avatar.length > 5;
    var initials = getInitials(m.name);
    var grad = getGradient(m.name);
    if (zoomedIn) {
      var html = '<div class="avatar-marker' + (m.isOnline ? ' online' : '') + '" style="border-color:' + m.color + ';' +
        (hasAvatar ? 'background-image:url(' + m.avatar + ')' : '') + '">' +
        (!hasAvatar ? '<div class="initials" style="background:' + grad + '">' + initials + '</div>' : '') +
        '</div>';
      return L.divIcon({ html: html, iconSize: [44, 44], iconAnchor: [22, 22], className: '' });
    } else {
      var dotHtml = '<div class="dot-marker' + (m.isOnline ? ' online' : '') + '" style="background:' + m.color + '"></div>';
      return L.divIcon({ html: dotHtml, iconSize: [14, 14], iconAnchor: [7, 7], className: '' });
    }
  }

  function renderMarkers() {
    markerLayer.clearLayers();
    var zoom = map.getZoom();
    var zoomedIn = zoom >= ZOOM_THRESHOLD;
    currentMarkers.forEach(function(m) {
      var icon = createMarkerIcon(m, zoomedIn);
      var marker = L.marker([m.lat, m.lng], { icon: icon, zIndexOffset: m.isOnline ? 100 : 0 }).addTo(markerLayer);
      marker.on('click', function() {
        selectedId = m.id;
        var hasAvatar = m.avatar && m.avatar.length > 5;
        var initials = getInitials(m.name);
        var grad = getGradient(m.name);
        var card = document.getElementById('userCard');
        var cardAvatar = document.getElementById('cardAvatar');
        var cardInitials = document.getElementById('cardInitials');
        if (hasAvatar) { cardAvatar.style.backgroundImage = 'url(' + m.avatar + ')'; cardInitials.style.display = 'none'; }
        else { cardAvatar.style.backgroundImage = 'none'; cardInitials.style.display = 'flex'; cardInitials.textContent = initials; cardInitials.style.background = grad; }
        cardAvatar.style.borderColor = m.color;
        document.getElementById('cardName').textContent = m.name;
        var roleEl = document.getElementById('cardRole');
        roleEl.textContent = m.role;
        roleEl.style.color = m.color;
        roleEl.style.background = m.color + '18';
        var metaEl = document.getElementById('cardMeta');
        if (m.isOnline) {
          metaEl.innerHTML = '<span class="card-online-badge">Online</span>' + (m.city ? ' · ' + m.city : '');
        } else {
          metaEl.textContent = [m.city, getTimeAgo(m.lastSeen), m.skills].filter(Boolean).join(' · ');
        }
        card.classList.add('show');
      });
    });
  }

  map.on('zoomend', function() { renderMarkers(); });

  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'centerOnLocation') {
      map.flyTo([e.data.lat, e.data.lng], 14, { duration: 1 });
    }
    if (e.data && e.data.type === 'updateMarkers') {
      currentMarkers = e.data.markers || [];
      renderMarkers();
    }
  });
  map.on('click', function() { closeCard(); });
<\/script>
</body>
</html>`;
}

const MAP_HTML = getMapHTML();

export default React.memo(function DirectoryMap({ markers, onMarkerPress, onChatPress }: DirectoryMapProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sentMarkersRef = useRef<string>('');

  const markersList = useMemo(() => markers.map(m => ({
    lat: m.latitude,
    lng: m.longitude,
    name: m.name,
    role: m.role,
    roleKey: m.roleKey,
    city: m.city || '',
    color: m.color,
    id: m.id,
    avatar: m.avatar || '',
    isOnline: m.isOnline,
    lastSeen: m.lastSeen || 0,
    skills: (m.skills || []).slice(0, 3).join(', '),
  })), [markers]);

  useEffect(() => {
    const key = markersList.map(m => m.id).sort().join(',');
    if (key === sentMarkersRef.current) return;
    sentMarkersRef.current = key;

    const sendMarkers = () => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'updateMarkers',
          markers: markersList,
        }, '*');
      }
    };

    const timer = setTimeout(sendMarkers, 500);
    return () => clearTimeout(timer);
  }, [markersList]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'viewProfile' && onMarkerPress) {
        onMarkerPress(e.data.id);
      }
      if (e.data?.type === 'chatUser' && onChatPress) {
        onChatPress(e.data.id);
      }
      if (e.data?.type === 'requestMyLocation') {
        if ('geolocation' in navigator) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              if (iframeRef.current?.contentWindow) {
                iframeRef.current.contentWindow.postMessage({
                  type: 'centerOnLocation',
                  lat: pos.coords.latitude,
                  lng: pos.coords.longitude,
                }, '*');
              }
            },
            () => {},
            { enableHighAccuracy: true }
          );
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onMarkerPress, onChatPress]);

  const handleLoad = React.useCallback(() => {
    setTimeout(() => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'updateMarkers',
          markers: markersList,
        }, '*');
      }
    }, 800);
  }, [markersList]);

  return (
    <View style={styles.container}>
      <iframe
        ref={iframeRef as any}
        srcDoc={MAP_HTML}
        onLoad={handleLoad}
        sandbox="allow-scripts allow-same-origin"
        style={{ width: '100%', height: '100%', border: 'none' } as any}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});